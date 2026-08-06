# Architecture diagrams

Four documents, each answering a different "show me" question. All were built by
reading the actual code on `main` (workspace `package.json`s, port `implements`
clauses, `SwapService`, the state machine, the security modules, and the GitHub PR
history) rather than transcribed from `SPEC.md`/`AGENTS.md`/`IMPLEMENTATION.md` alone
— where the running code and the prose disagree in emphasis, these docs follow the
code and say so.

| Document | Answers |
| --- | --- |
| [`dependency-graph.md`](./dependency-graph.md) | What depends on what? Which adapter implements which port? |
| [`swap-flow.md`](./swap-flow.md) | What actually happens during one swap, message by message? What are the legal state transitions? |
| [`security-pipeline.md`](./security-pipeline.md) | What gates an incoming connection and its content, and in what order? |
| [`roadmap.md`](./roadmap.md) | How was this built — which phase, which critical-path gate, which PR? |

Regeneration notes live inline in each doc (`dependency-graph.md` §3 has a literal
script). If the code moves and a diagram doesn't, trust the code — then fix the
diagram, don't route around it.
