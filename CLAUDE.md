# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- `AGENTS.md` (imported above) is the shared source of truth for all agents.
  Put project rules there, and only Claude-specific notes here.
- Reply to the user in Portuguese (pt-BR). Code, comments and commits stay in
  English, as described in AGENTS.md.
- `bun start` opens a GUI window and scans the whole disk. Launch it only when
  you need to verify desktop behavior, and quit it afterwards.
- For CLI checks, prefer `bun run scan --home <tempdir>` or `--category <slug>`
  over a full scan of the real home.
