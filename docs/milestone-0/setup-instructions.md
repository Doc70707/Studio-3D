# Setup instructions

There are two levels. **Part A is all you need for now.** Part B is only for if you later want to build the app on your own PC.

## Part A: what I need from you before Milestone 1 (about 10 minutes)

1. **Create a GitHub account** at https://github.com/signup, if you don't have one. The free plan is fine.
2. **Create an empty repository.**
   1. Go to https://github.com/new.
   2. Name it something like `studio3d` and set it to **Private**.
   3. Leave "Add a README" unticked.
   4. Click **Create repository**.
3. **Connect GitHub to Claude** at https://claude.ai/connect-github. When asked, install the Claude GitHub App on **only** that new repository.
4. **Add the repository to this project** under Project settings → Resources (repositories).
5. Tell me in the thread when it's done.

After that, I write the code, push it to your repository, and GitHub's hosted Windows machines build the installer automatically. You download the result from the repository's **Actions** tab (a `.msi`/`.exe` file) and run it on your PC to confirm it starts. That's the real-Windows proof your plan asks for.

## Part B: developer setup on your Windows PC (optional, later)

Install these in order. Use the default options unless noted.

1. **Git for Windows** from https://git-scm.com/download/win.
2. **Node.js 22 LTS** from https://nodejs.org (the LTS installer). Check it worked: open PowerShell and run `node --version`.
3. **Microsoft C++ Build Tools** from https://visualstudio.microsoft.com/visual-cpp-build-tools/. In the installer, tick **"Desktop development with C++"**. This step is required by Tauri.
4. **WebView2.** It is already included in Windows 10 (version 1803 and later) and Windows 11. Only if the app later complains, install the "Evergreen Bootstrapper" from https://developer.microsoft.com/en-us/microsoft-edge/webview2/.
5. **Rust** from https://rustup.rs. Run `rustup-init.exe` and make sure the default host is `x86_64-pc-windows-msvc`. If you already have Rust, run `rustup default stable-msvc`. **Restart PowerShell** afterwards.
6. **VS Code** (optional editor) from https://code.visualstudio.com.

Then, in PowerShell (the repository URL is filled in once it exists):

```powershell
git clone https://github.com/<you>/studio3d.git
cd studio3d
npm ci
npm test               # geometry and unit tests
npm run desktop:dev    # opens the app window
```

The exact commands are created and tested in Milestone 1. This section will be updated to match what actually works.

Sources: [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (page updated 2026-08-20).

## Rerunning the Milestone 0 smoke test (any machine with Node 22 and Python 3)

```bash
cd milestone-0/poc
npm install
npm run poc        # 11 kernel checks
pip install trimesh numpy numpy-stl cadquery-ocp
npm run verify     # independent STL + STEP checks
npm run manifold   # mesh engine check
```
