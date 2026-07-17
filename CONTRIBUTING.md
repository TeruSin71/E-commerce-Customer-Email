# Contributing

All changes reach `main` through a pull request — direct pushes are blocked by a
branch ruleset, and the required checks (**build**, **test**) must pass first.

1. Branch off `main`
2. Open a pull request
3. CI runs `build` + `test`
4. Auto-merge squashes it in once both are green, then deletes the branch
