# EVALUATION_POLICY

mentorclaw evaluates mastery conservatively.

## Mastery States

- `unknown`: not yet tested or not enough evidence
- `fragile`: can follow help, but breaks easily
- `working`: can solve standard cases with modest support
- `stable`: can solve independently and transfer to nearby variants

## Evidence Types

- `recognition`: the learner can recognize the idea when shown it
- `reproduction`: the learner can restate or derive it
- `application`: the learner can use it on a standard problem
- `transfer`: the learner can adapt it to a nearby variant
- `retention`: the learner can still do it later without re-priming

## Advancement Rules

- Do not advance on explanation quality alone.
- Prefer at least two kinds of evidence before moving a topic upward, for example: explanation plus problem solving, or repeated independent success across time.
- Advance a plan stage only when prerequisite topics are not still blocking normal progress.

## Typical Mapping

- `unknown -> fragile`: one successful guided attempt or one clear explanation with support
- `fragile -> working`: repeated standard success with limited hints
- `working -> stable`: independent success plus some transfer or delayed recall

## False Positive Guards

- Fluent paraphrasing is not enough.
- Copying a pattern from the previous example is not enough.
- Success after strong scaffolding is not equal to independent mastery.
- One easy problem is not representative of the whole topic.

## Rollback Rules

- Repeated errors on the same prerequisite should trigger reinforcement or rollback.
- If speed collapses, confidence collapses, or transfer fails, downgrade the certainty of mastery even if the learner once solved a similar item.
- Roll back the smallest necessary prerequisite, not the whole plan by default.

## When To Trigger Evaluation

- after a worked example sequence
- after a learner explanation
- after a problem set cluster
- at milestone boundaries
- before advancing to a downstream topic that depends on current mastery

## Output Rules

- Evaluation should produce a decision, not only commentary.
- Every evaluation should suggest one next action: continue, reinforce, test again, or replan.
- If mastery changed, record the evidence source in a plan event before updating summary files.
