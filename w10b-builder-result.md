# W10B project review and isolated display work

The builder is Codex, gpt-6.1-sol, with high reasoning effort.
The retained session is 01a1c1d2-f89b-7e22-b89e-f0e9e130435f.
The accepted parent is b974da06b2c95317f206132bc0baeece3c0384a1.
This is an independent implementation checkpoint, not unit acceptance.
Setup directly reuses the accepted NewProjectDialog and NewProjectSession contracts.
Shell composition remains separate from this checkpoint.

## The owner-approved editor sandbox correction

Product commit e740c19 gives editor frames allow-scripts allow-same-origin in both the iframe attribute and the display content security policy.
Recorded mocks retain their opaque sandbox.
The editor retains only the separate display hostname's origin and storage.
Owner cookies, owner application programming interface authority, frame ancestors, referrer policy, credential-omitting import, revocation and logout controls remain unchanged.
The image stays lgtm-openpencil:w10b-cb71737-build1, with the approved NET_BIND_SERVICE capability and every other existing confinement flag.
No OpenPencil patch, image build, pull or retag was applied.
All temporary startup and boot-notice observations were removed from active source and the native case.

## Actual remote results

Confirmed live at product commit e740c19: engine, web and native-input typing passed through run-remote-test.
All 34 related tests passed across engine display boundaries, engine project review and web project review.
The final native case passed in 10.6 seconds.
It proves recorded mock CSS, module and image delivery; the registered editor tab, component and canvas; credential-free modules and WebAssembly; a browser hash of the exact issued file; separate-origin owner isolation; the exact approved capability and container restrictions; revocation; logout; and awaited owned-container cleanup.
The actual outcome records completed=true, ownedContainerNameKnown=true, ownedContainerAbsent=true and ownedContainersAbsent=true.
A separate Docker listing for the approved image was empty.
The screenshots include the actual desktop and phone editor views.
OpenPencil reports one unavailable or substituted font, so exact font fidelity remains unproved.

The original source23 and localStorage failures remain preserved.
Four related native failures after this correction remain preserved too.
The first exposed an unhandled Playwright response-body read; two subsequent runs retained the strict byte proof while diagnosing that unavailable observation; the fourth reached Docker's CAP_NET_BIND_SERVICE spelling.
The final case verifies the actual issued file inside the browser with credentials omitted, and normalizes only Docker's optional CAP_ prefix while still requiring exactly one capability.
The original document import, component, canvas and isolation assertions remain.
No request is intercepted, replaced or fulfilled.
The first native pass was followed by one screenshot timing correction to await the welcome dialog's actual closure; the final pass includes that correction.

The ordinary logs, actual exits, final native case and useful screenshots are in website-1/w10b-document-import.
The active native input remains .scratch/w10b-foundation-resume/display-tag601/display.spec.ts, with its existing configuration and entry files.
No local test, direct Secure Shell command, new manifest, collection receipt or frozen request was produced.
No full-check pass, completed Shell integration, push, merge or unit acceptance is claimed.

## The first ordinary full check and its correction

The ordinary run-remote-test check at 720077d returned 1.
Typechecking passed, and Vitest reported 7,650 passing tests, two skipped tests and two failed repository guards.
Browser and credit stages were not executed after that failure.
The display callback now revalidates its caller through the existing webCaller boundary instead of constructing an owner credential.
The two pure display test files now declare their event-log-free rebuild registration.
The failed and related checks, followed by the final full gate, are running on the corrected signed commit.
The image, sandbox ruling, native input, deadlines and isolation controls remain unchanged.
