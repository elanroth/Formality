/- Injected after the user's imports/source. The caller supplies `import Lean`.
   A typed expression/dependency tree, not a trace of kernel inference judgments.
   Expansion is performed on expressions, then the transformed closed proof is
   submitted to the kernel as a fresh theorem before its tree is exported. -/
namespace ProofTreeTool
open Lean Meta Elab Command

structure Config where
  declaration : String
  output : String
  mode : String := "raw"
  expand : Array String := #[]
  expandDepth : Nat := 0
  maxNodes : Nat := 20000
  maxDepth : Nat := 300
  maxVisits : Nat := 500000
  normalize : Bool := false
  specialize : Array (String × Nat) := #[]
  deriving FromJson

structure Work where
  visited : Nat := 0
  -- Structural equality preserves binder names/annotations in the exported tree.
  expansionCache : Std.HashMap (ExprStructEq × Nat × Array Name) (Expr × Array String) := {}
  expansions : Array String := #[]
  applied : Array String := #[]
  nodes : Array Json := #[]
  cut : Bool := false
  cutoff : Option Nat := none
  refs : Array String := #[]

abbrev M := StateRefT Work MetaM

def tick (limit : Nat) : M Unit := do
  modify fun s => {s with visited := s.visited + 1}
  if (← get).visited > limit then
    throwError "Transformation budget exceeded ({limit} uncached visits); reduce lemma expansion or increase maxVisits."

def shortPP (e : Expr) : MetaM String :=
  withOptions (fun o => (o.set `pp.maxDepth (10 : Nat)).set `pp.maxSteps (1500 : Nat)) do
    return String.ofList ((← ppExpr e).pretty.toList.take 2200)

partial def specializeExpr (e ty : Expr) (items : Array (String × Nat)) : M (Expr × Expr) := do
  if items.isEmpty then return (e, ty)
  match (← whnf ty) with
  | .forallE n domain body bi =>
    if let some (_, k) := items.find? (fun item => item.1 == n.toString) then
      unless ← isDefEq domain (mkConst ``Nat) do
        throwError "Binder {n} has type {domain}; numeric specialization supports Nat binders."
      let arg := mkNatLit k
      modify fun s => {s with applied := s.applied.push n.toString}
      specializeExpr (e.beta #[arg]) (body.instantiate1 arg)
        (items.filter fun item => item.1 != n.toString)
    else
      withLocalDecl n bi domain fun x => do
        let (v, t) ← specializeExpr (e.beta #[x]) (body.instantiate1 x) items
        return (← mkLambdaFVars #[x] v, ← mkForallFVars #[x] t)
  | _ => throwError "Specialization binder(s) not found: {items.map Prod.fst}"

partial def expandExpr (e : Expr) (cfg : Config) (level : Nat := 0)
    (stack : Array Name := #[]) : M Expr := do
  let e := e.consumeMData
  -- Free-variable identities are structural key components. Reused results
  -- therefore refer to the same locals; binders introduced here are abstracted.
  let cacheable := !e.hasMVar && !e.hasLooseBVars
  let key := (ExprStructEq.mk e, level, stack)
  if cacheable then
    if let some (value, history) := (← get).expansionCache[key]? then
      modify fun s => {s with expansions := s.expansions ++ history}
      return value
  tick cfg.maxVisits
  let firstExpansion := (← get).expansions.size
  let value ← (do
    if let .const n us := e.getAppFn then
      let info ← getConstInfo n
      let selected := cfg.expand.contains n.toString ||
        (level < cfg.expandDepth && info.isTheorem)
      if selected && !stack.contains n then
        if let some v := info.value? (allowOpaque := true) then
          -- Actual arguments retain their current expansion depth. Only entering
          -- a declaration body consumes a level; beta substitution comes last.
          let args ← e.getAppArgs.mapM fun a => expandExpr a cfg level stack
          let body ← expandExpr (v.instantiateLevelParams info.levelParams us) cfg
            (level+1) (stack.push n)
          modify fun s => {s with expansions := s.expansions.push n.toString}
          return body.beta args
    match e with
    | .lam n t b bi =>
      withLocalDecl n bi t fun x => do
        let b ← expandExpr (b.instantiate1 x) cfg level stack
        mkLambdaFVars #[x] b
    | .forallE n t b bi =>
      withLocalDecl n bi t fun x => do
        let b ← expandExpr (b.instantiate1 x) cfg level stack
        mkForallFVars #[x] b
    | .letE n t v b _ =>
      let v ← expandExpr v cfg level stack
      withLetDecl n t v fun x => do
        let b ← expandExpr (b.instantiate1 x) cfg level stack
        mkLambdaFVars #[x] b (usedLetOnly := false)
    | .app f a => return mkApp (← expandExpr f cfg level stack) (← expandExpr a cfg level stack)
    | .proj n i s => return .proj n i (← expandExpr s cfg level stack)
    | _ => return e
    : M Expr)
  if cacheable then
    let history := (← get).expansions.extract firstExpansion (← get).expansions.size
    modify fun s => {s with expansionCache := s.expansionCache.insert key (value, history)}
  return value

def classify (e : Expr) : MetaM (String × String × Bool) := do
  match e with
  | .const n _ =>
    let info ← getConstInfo n
    let kind := match info with
      | .axiomInfo _ => "axiom"
      | .recInfo _ => "recursor"
      | .ctorInfo _ => "constructor"
      | .thmInfo _ => "lemma"
      | _ => "reference"
    return (kind, n.toString, (info.value? (allowOpaque := true)).isSome)
  | .fvar _ => return ("hypothesis", "", false)
  | _ => return ("reference", "", false)

def reserve (rule term type detail : String) (expandable : Bool := false) : M Nat := do
  let id := (← get).nodes.size
  modify fun s => {s with nodes := s.nodes.push <| Json.mkObj [
    ("id", toJson id), ("rule", toJson rule), ("term", toJson term),
    ("type", toJson type), ("detail", toJson detail),
    ("expandable", toJson expandable), ("children", toJson (#[] : Array Nat))]}
  return id

def attach (id : Nat) (children : Array Nat) : M Nat := do
  modify fun s => {s with nodes := s.nodes.modify id fun j =>
    match j with
    | .obj o => .obj (o.insert "children" (toJson children))
    | _ => j}
  return id

partial def tree (e : Expr) (cfg : Config) (depth : Nat := 0) : M Nat := do
  let s ← get
  if s.nodes.size >= cfg.maxNodes - 1 then
    modify fun s => {s with cut := true}
    if let some id := s.cutoff then return id
    let id ← reserve "cutoff" "Node budget reached" "" "Increase the node budget to include this subtree."
    modify fun s => {s with cutoff := some id}
    return id
  if depth >= cfg.maxDepth then
    modify fun s => {s with cut := true}
    return ← reserve "cutoff" "Depth budget reached" "" "Increase the depth budget to include this subtree."
  let e := e.consumeMData
  let ty ← inferType e
  let pp ← shortPP e
  let pt ← shortPP ty
  match e with
  | .lam n t b bi =>
    withLocalDecl n bi t fun x => do
      if cfg.mode == "compact" && !(← isProp t) then
        return ← tree (b.instantiate1 x) cfg depth
      let id ← reserve "intro" pp pt n.toString
      let mut kids := #[]
      if cfg.mode == "raw" then kids := kids.push (← tree t cfg (depth+1))
      kids := kids.push (← tree (b.instantiate1 x) cfg (depth+1))
      attach id kids
  | .forallE n t b bi =>
    let id ← reserve "type" pp pt n.toString
    withLocalDecl n bi t fun x => do
      attach id #[← tree t cfg (depth+1), ← tree (b.instantiate1 x) cfg (depth+1)]
  | .letE n t v b _ =>
    let id ← reserve "let" pp pt n.toString
    withLetDecl n t v fun x => do
      attach id #[← tree v cfg (depth+1), ← tree (b.instantiate1 x) cfg (depth+1)]
  | .app f a =>
    let id ← reserve "app" pp pt ""
    if cfg.mode == "raw" then
      attach id #[← tree f cfg (depth+1), ← tree a cfg (depth+1)]
    else
      let head := e.getAppFn
      let (kind, detail, _) ← classify head
      let mut kids := #[]
      if kind != "constructor" && kind != "recursor" then
        kids := kids.push (← tree head cfg (depth+1))
      for a in e.getAppArgs do
        if ← isProof a then kids := kids.push (← tree a cfg (depth+1))
      modify fun s => {s with nodes := s.nodes.modify id fun j =>
        match j with
        | .obj o => .obj ((o.insert "rule" (toJson (if kind == "constructor" || kind == "recursor" then kind else "app"))).insert "detail" (toJson detail))
        | _ => j}
      attach id kids
  | .proj n i v =>
    let id ← reserve "projection" pp pt s!"{n}.{i}"
    attach id #[← tree v cfg (depth+1)]
  | .const .. | .fvar .. =>
    let (kind, detail, expandable) ← classify e
    if expandable then modify fun s => {s with refs := s.refs.push detail}
    reserve kind pp pt detail expandable
  | .sort .. | .lit .. => reserve "type" pp pt ""
  | .mvar .. => throwError "Unresolved metavariable in exported proof."
  | .bvar .. => throwError "Loose bound variable in exported proof."
  | .mdata .. => throwError "Unconsumed metadata."

def parameters (ty : Expr) : MetaM (Array Json) :=
  forallTelescope ty fun xs _ => xs.mapM fun x => do
    let decl ← x.fvarId!.getDecl
    let isNat ← isDefEq decl.type (mkConst ``Nat)
    return Json.mkObj [("name", toJson decl.userName.toString),
      ("type", toJson (← shortPP decl.type)), ("isNat", toJson isNat)]

def resolveDeclaration (name : Name) : MetaM Name := do
  let env ← getEnv
  let opts ← getOptions
  return match ResolveName.resolveGlobalName env opts .anonymous [] name with
    | (resolved, []) :: _ => resolved
    | _ => name

def exportJson (cfg : Config) (j : Json) (originalType ty : Expr)
    (root : Nat) (axioms : Array Name) (s : Work) : MetaM Json := do
  -- Keep pretty printing/JSON assembly outside StateRefT. This also avoids
  -- excessive compiler recursion in the browser's Lean 4.33 runtime.
  let statement ← shortPP originalType
  let displayStatement ← shortPP ty
  let params ← parameters originalType
  let imports ← (← getEnv).header.moduleNames.mapM fun mod => do
    let file ← liftM (findOLean mod)
    return Json.mkObj [("module", toJson mod.toString), ("path", toJson file.toString)]
  let identity := [
    ("schema", toJson "proof-tree/v1"), ("declaration", toJson cfg.declaration),
    ("statement", toJson statement), ("displayStatement", toJson displayStatement),
    ("parameters", toJson params)]
  let shape := [
    ("root", toJson root), ("nodes", toJson s.nodes),
    ("axioms", toJson (axioms.map Name.toString)),
    ("references", toJson s.refs.toList.eraseDups.toArray),
    ("expansions", toJson s.expansions), ("specialized", toJson s.applied)]
  let status := [
    ("truncated", toJson s.cut), ("kernelChecked", toJson true),
    ("mode", toJson cfg.mode), ("config", j),
    ("importedModules", toJson imports),
    ("semantics", toJson "Typed expression tree. Compact mode groups applications and omits type/data arguments. Not a complete typing or conversion derivation.")]

  return Json.mkObj (identity ++ shape ++ status)


/-- Extract a declaration inside an existing Lean environment. The command below
is an IO adapter; this MetaM API is also usable by other Lean metaprograms. -/
def exportDeclaration (cfg : Config) (j : Json := Json.null) : MetaM Json := do
  if cfg.maxNodes < 10 then throwError "maxNodes must be at least 10"
  if cfg.mode != "raw" && cfg.mode != "compact" then throwError "Unknown tree mode: {cfg.mode}"
  let n ← resolveDeclaration cfg.declaration.toName
  let expanded ← cfg.expand.mapM fun name => do
    return (← resolveDeclaration name.toName).toString
  let cfg := {cfg with expand := expanded}
  let info ← getConstInfo n
  let some original := info.value? (allowOpaque := true) |
    throwError "{n} has no accessible proof body (it may be an axiom)."
  unless ← isProp info.type do
    throwError "{n} is not a proposition-valued proof declaration."
  let certificate ← mkFreshUserName `ProofTreeTool.checkedExport
  let ((ty, root, axioms), s) ← (do
      let (value, ty) ← specializeExpr original info.type cfg.specialize
      let value ← if cfg.expandDepth > 0 || !cfg.expand.isEmpty then expandExpr value cfg else pure value
      let value ← if cfg.normalize then
        withTransparency .all <| reduce value (explicitOnly := false) (skipTypes := true) (skipProofs := false)
        else pure value
      addDecl <| Declaration.thmDecl {
        name := certificate
        levelParams := info.levelParams
        type := ty
        value := value }
      let root ← tree value cfg
      let axioms ← collectAxioms certificate
      return (ty, root, axioms)
      : M (Expr × Nat × Array Name)).run {}
  exportJson cfg j info.type ty root axioms s

elab "#proof_tree " config:str : command => do
  let j ← match Json.parse config.getString with
    | .ok j => pure j
    | .error e => throwError "Invalid config JSON: {e}"
  let cfg : Config ← match fromJson? j with
    | .ok c => pure c
    | .error e => throwError "Invalid config: {e}"
  liftTermElabM do
    let result ← exportDeclaration cfg j
    liftM <| IO.FS.writeFile cfg.output result.compress
end ProofTreeTool
