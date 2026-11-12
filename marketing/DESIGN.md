# The marketing page's visual direction

LGTM Studio's marketing page introduces the product and invites early-access signups.
It has a separate visual identity from the working product.
The owner explicitly authorized that separation on 2026-11-11.
This direction is a reviewable proposal, not a frozen product design contract.

## What the page should make clear

A visitor has an idea and wants a team of coding agents to move it forward.
The headline introduces that outcome.
The first product image makes the workspace concrete.
The workflow diagram explains the project lead and the teams.
The mobile capture shows the smaller-screen experience.
The final form collects email addresses with explicit consent.

## How the visual choices support the message

The light background keeps the screenshots prominent.
Deep green text supplies contrast.
Lime marks the primary signup actions and the headline's emphasis.
The dark signup section makes the final action easy to find.
The product screenshots retain their own palette.
They are labelled as previews.

The page uses the existing self-hosted Inter font for readable product-oriented copy.
Large display text uses a medium weight and tight spacing.
Body text has a narrower reading measure.
The palette is in `public/tokens.css`.
The page supports light and dark presentations.
Dark mode uses layered green surfaces and readable pale text.
The lime actions and the product captures keep their original colors.
The navigation has a keyboard-accessible theme switch.
A first visit follows the device preference.
A manual choice is remembered in browser storage when it is available.
The theme initializes before the styles paint to avoid a flash of the wrong palette.
Text, button surfaces, the input, and screenshot chrome use separate color roles.

## What the UI guidance contributed

The UI router, design-forge guidance, craft floor, and presentation-led site guidance were read before implementation.
The design catalog query was `developer tool agent orchestration product launch minimal bold typography`.
Its documentation-search layout and dark-mode recommendation did not fit this brief.
Those recommendations were discarded.
The composition instead uses the owner's explicit marketing brief and the craft floor.

There are no invented customers, testimonials, adoption numbers, or speed claims.
There is no repeated grid of generic feature cards.
The diagram describes the actual hierarchy instead of pretending to be a product screenshot.
Motion is limited to one hero entrance.
Reduced-motion preferences disable it.
The form keeps its contents after a failed request.
Keyboard focus remains visible.

## What the captures prove

The browser captures show the light landing page at four viewport widths.
They also show dark mode at desktop and mobile widths.
The results are recorded in `verification/results.json`.
The design detector ran in its documented regex fallback.
Its parser dependencies were unavailable.
That result is not a full accessibility audit.
The owner's future recording has not been tested for playback.
