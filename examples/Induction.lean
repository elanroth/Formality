namespace Induction

theorem liftEquality {a b : Nat} (h : a = b) : Nat.succ a = Nat.succ b :=
  congrArg Nat.succ h

theorem zeroAdd (n : Nat) : 0 + n = n := by
  induction n with
  | zero => rfl
  | succ n ih => exact liftEquality ih

theorem iterate (P : Nat → Prop) (base : P 0)
    (step : ∀ k, P k → P (k+1)) (n : Nat) : P n :=
  Nat.rec base (fun k ih => step k ih) n

end Induction
