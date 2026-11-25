# Profile README setup

GitHub shows the README of a repo named after your username at the top of your profile.

1. Create a **public** repo named exactly `idreesdev538` (no template, no README).
2. Check the links in `profile.config.json` (portfolio, LinkedIn, email).
3. Push this folder:
   ```bash
   git init -b main && git add -A && git commit -m "Profile README"
   git remote add origin https://github.com/idreesdev538/idreesdev538.git
   git push -u origin main
   ```
4. Repo **Settings → Actions → General → Workflow permissions**: choose *Read and write*.
5. **Actions** tab → *Redraw profile* → *Run workflow* once.

## Day to day

- Change text, links or skills: edit `profile.config.json`, push. The Action redraws everything.
- Preview locally: `node scripts/build.mjs`, then open the SVGs in `assets/`.
- The "On GitHub" stats card stays hidden until you pass `statsMinContributions` (150) in a year. Set it to `0` to always show it.
- To count private work: GitHub profile → *Contributions & activity* → enable **Private contributions**. For the most accurate numbers, add a classic token with `read:user` as the repo secret `PROFILE_TOKEN`.
