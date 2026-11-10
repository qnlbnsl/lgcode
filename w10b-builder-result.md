# W10B project review and isolated display work

The builder is Codex, gpt-6.1-sol, with high reasoning effort.
The retained session is 01a1c1d2-f89b-7e22-b89e-f0e9e130435f.
This is an independent implementation checkpoint, not unit acceptance.
The accepted parent is b974da06b2c95317f206132bc0baeece3c0384a1.

Setup reuses the accepted NewProjectDialog and NewProjectSession contracts.
The project Setup, Mocks and repository Design components and isolated display service are implemented independently.
Shell composition remains separate from this checkpoint.
The display uses the owner-selected separate hostname and an opaque sandbox.
The editor image remains lgcode-openpencil:w10b-cb71737-build1.
The owner-approved launch adds NET_BIND_SERVICE immediately after dropping all capabilities.
Every other confinement flag remains, and all temporary startup diagnostics were removed.

The manager's source23 engine and native typing commands passed.
All seven focused display-boundary tests passed.
The native case opened the editor frame and found the actual owned container, then failed because the registered document tab did not appear.
The CapAdd assertion occurs after that failure in the actual spec, so that assertion was not reached by this run.
The actual outcome confirms owned-container cleanup.
The extra unnamed Playwright error remains unattributed.
Historical logs and owner rulings remain in the website-1 run folder.

The owner switched this work to the build loop.
The builder now runs failed and related checks through run-remote-test on the remote personal computer.
Commit hashes identify source, ordinary logs preserve actual results, and no further per-run manifests or collection receipts are produced.
The registered-document import remains under active repair.
No editor import, complete pixel proof, full-check pass or unit acceptance is claimed.
