universe u
namespace Diagonal

theorem selfContradiction (p : Prop) (h : p ↔ ¬p) : False := by
  have hn : ¬p := fun hp => (h.mp hp) hp
  exact hn (h.mpr hn)

/-- Cantor's diagonal argument, with subsets represented by predicates. -/
theorem cantor (α : Type u) (f : α → α → Prop) :
    ¬ (∀ p : α → Prop, ∃ a, f a = p) := by
  intro onto
  obtain ⟨a, ha⟩ := onto (fun x => ¬ f x x)
  exact selfContradiction (f a a) (iff_of_eq (congrFun ha a))

end Diagonal
