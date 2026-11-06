namespace Propositional

inductive Formula where
  | atom : Nat → Formula
  | imp : Formula → Formula → Formula

def Eval (v : Nat → Prop) : Formula → Prop
  | .atom n => v n
  | .imp p q => Eval v p → Eval v q

/-- The K/S Hilbert calculus for the implicational fragment. -/
inductive Proof : Formula → Type where
  | axK (p q) : Proof (.imp p (.imp q p))
  | axS (p q r) : Proof (.imp (.imp p (.imp q r)) (.imp (.imp p q) (.imp p r)))
  | mp {p q} : Proof (.imp p q) → Proof p → Proof q

theorem soundness {p : Formula} (h : Proof p) (v : Nat → Prop) : Eval v p := by
  induction h with
  | axK p q => exact fun hp _ => hp
  | axS p q r => exact fun hf hg hp => hf hp (hg hp)
  | mp hf hp ihf ihp => exact ihf ihp

end Propositional
