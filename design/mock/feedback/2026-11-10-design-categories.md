<!-- Written by the Design lead agent on 2026-11-10 at the owner's request. This is a proposal awaiting the owner's approval. -->

# The design file standard and the Design page's two menus

This standard is a proposal. The owner has not approved it. Nothing in it is binding until
the owner says so.

The owner's verdict on 2026-11-11: "I'm not approving it, but it is a good start. We'll have
to refine those categories as I use this thing." The categories stay as a starting point,
and they change as the owner uses the Design page.

It says how a repository keeps its design file, how the file is named inside, and how its
content fills the two menus and the canvas of the repository Design page.

## The one idea behind the standard

A designer finds things in a design file by its page list. So the page list is the menu.
Each page name has the form `Category / Item`. The first menu lists the categories. The
second menu lists the items. The canvas shows that page. Variables are the one exception,
because they live in collections and not on pages.

## Where the design file lives and what it is named

| Rule | Value |
|---|---|
| Folder | `design/` at the root of the repository |
| File name | `design/<repository name>.fig`, such as `design/lgtm.fig` |
| Format | An OpenPencil file, which is a zip archive holding `canvas.fig`, `meta.json` and `thumbnail.png` |
| Number of files | One design file for each repository |
| Tokens for code | `design/tokens.css`, kept in step with the file's variables |

The design file is the source of truth. The Cascading Style Sheets (CSS) file follows it.
When the two disagree, the Design page shows the difference and does not hide it.

## How the inside of the file is named

### Pages

| Page name | What it holds | Where it appears |
|---|---|---|
| `Screens / <Flow>` | The screens of one flow | Screens, one item for each flow |
| `Components / <Group>` | The component sets of one group | Components, one item for each group |
| `Palette / Icons` | One component for each icon | Palette, the Icons item |
| A name starting with `_`, such as `_Archive` | A designer's working page | Never shown |
| OpenPencil's internal page | The variables | Never shown as a page |

The separator is a space, a forward slash and a space. Case is kept as written. The page
order in the file is the order in the second menu.

A page whose name matches no row above is shown under Screens as its own item. The item is
marked "Not named to the standard", so the file can be fixed.

### Frames on a Screens page

| Rule | Example |
|---|---|
| A frame is named `<Screen>` or `<Screen> / <State>` | `Login / Session expired` |
| A frame with no state is the default state | `Home` |
| A phone layout is a state whose name ends in `Phone` | `Home / Phone`, `Board / Empty, Phone` |
| Only frames at the top level of the page count as screens | A frame inside a frame is part of its screen |
| Sections on the page are for arrangement only | The menus never read them |

### Component sets on a Components page

| Rule | Example |
|---|---|
| A component set is named by the component, in sentence case | `Status dot` |
| Its name matches the component's name in code where one exists | `Menu` matches `Menu` in `ui.js` |
| Each variant is named `Property=Value, Property=Value` | `Kind=Primary, State=Hover` |
| The first property gives the rows of the sheet, and the second gives the columns | Kind by State |
| A component with no variants is a single component with the plain name | `Attention number` |

### Variables

| Rule | Example |
|---|---|
| A variable is named `<prefix>/<name>` or `<prefix>/<Group>/<name>` | `color/bg`, `color/Surfaces/bg` |
| The CSS variable is `--<prefix>-<name>`, and the group is dropped | `color/Surfaces/bg` is `--color-bg` |
| The variable's description holds the CSS reference | `var(--color-bg)` |
| Colour modes are named Field and Dusk | Field is light, and Dusk is dark |
| Density modes are named Compact and Regular | Compact is the default |

The prefix decides the Palette item, as the table below shows.

| Palette item | Prefixes |
|---|---|
| Colour | `color` |
| Type | `font`, `text`, `weight`, `leading`, `measure` |
| Space and density | `space`, `row`, `control`, `inset`, `gap`, `topbar`, `tabrow` |
| Shape | `radius`, `shadow` |
| Motion | `motion`, `ease` |

## The first menu

The first menu always holds the same three categories, in this order.

| Category | What it holds | Where its items come from |
|---|---|---|
| Screens | Every screen, grouped by flow | The `Screens / <Flow>` pages |
| Components | Every component, grouped by kind | The `Components / <Group>` pages, after a fixed list |
| Palette | Colour, type, space, shape, motion and icons | The variables and the `Palette / Icons` page |

There is no fourth category. A new kind of content becomes an item inside one of the three.

## The second menu

### Screens

The flows belong to the product, so there is no fixed list. The second menu lists the
`Screens / <Flow>` pages in file order.

### Components

The second menu starts with a fixed list that every repository shows. Groups that a
repository adds, such as a group for its own product parts, follow the fixed list in file
order.

| Fixed group | What belongs in it |
|---|---|
| Overview | One default instance of every component, built by the page, not drawn |
| Actions | Buttons, icon buttons and links |
| Inputs | Text fields, text areas, selects, switches, checkboxes and segmented controls |
| Navigation | Sidebar rows, tree rows, tabs, breadcrumbs and the top bar |
| Overlays | Menus, dialogs, toasts and tooltips |
| Status | Dots, badges, tags, counts, meters, progress, callouts and empty states |
| Data | Tables, list rows, description lists and keyboard keys |

### Palette

The second menu is fixed: Colour, Type, Space and density, Shape, Motion and Icons.

## What each item shows on the canvas

| Item | The canvas shows |
|---|---|
| A Screens flow | A flow sheet. Every frame of the page is drawn where the designer placed it and fitted to the window. Each frame has its name above it. Clicking a frame zooms to it. |
| Components, Overview | A sticker sheet with one default instance of every component, labelled by group. |
| A Components group | A component sheet. Each component set is a labelled block. Its variants sit in a grid, with the first property as rows and the second as columns, and the property values as axis labels. |
| Colour | A token table. The columns are swatch, token, Field value, Dusk value, CSS variable, and agreement with `design/tokens.css`. Rows are grouped by the variable's group. |
| Type | A type ramp. Each row shows the token, its size, weight and leading, and a sample line set in it. |
| Space and density | A ruler of the space scale, then a density table with a Compact column and a Regular column. |
| Shape | Radius tiles and shadow tiles, each labelled with its token and value. |
| Motion | A table of durations and easings, each with a small square that moves on hover. |
| Icons | A grid of icons, each labelled with its name. |

When a page has no positions to respect, such as frames drawn from code, the flow sheet
lays out one row for each screen and one column for each state, with the default state
first.

## When a category or an item is empty

- Every category stays in the first menu, even when it is empty.
- Every fixed item stays in the second menu, even when it is empty.
- An empty item shows its own structure on the canvas, never a blank page and never a
  different page.
- An empty flow sheet shows one dashed frame at 1440 by 900 pixels. Its label names the
  page to create, such as `Screens / Onboarding`.
- An empty component sheet shows its group heading and one dashed block. Its label names
  the page to create, such as `Components / Inputs`.
- An empty token table shows its column headings and no rows.
- When Screens has no flows at all, the second menu holds one item named "No flows yet",
  and the canvas shows the empty flow sheet.
- When a token is in `design/tokens.css` but not in the file, its row is shown and marked
  "Only in code".
- When a component exists in code but not in the file, the page may draw it from code. Its
  block is marked "Only in code".

## The bar above the canvas

The bar is one row, the height of the tab row. It holds, from left to right:

1. The first menu, showing the current category.
2. The second menu, showing the current item. Its entries show a count of frames,
   components or tokens.
3. The zoom controls: zoom out, the zoom level, zoom in, and Fit.
4. The "Open in OpenPencil" button, which opens the current page in the editor.

There is no third menu. A single frame is reached by clicking it on the canvas.

## The address of an item

An item has its own address: `/r/<repository>/design/<category>/<item>`. Both parts are in
lower case, with hyphens for spaces, such as `/r/lgtm/design/screens/sign-in-and-setup`.
The address `/r/<repository>/design` opens the first item of Screens.

## LGTM Studio's own items

### Screens for LGTM Studio

The flows follow the owner's path through the product. Each frame names the mock address
that draws it.

| Flow | Frames, as `Screen / State`, with the mock address |
|---|---|
| Sign in and setup | `Login` (`/login`), `Login / Rejected`, `Login / Session expired`, `Login / Service unavailable`, `Login / Insecure connection` (`/login?insecure=1`), `First run / Subscription` (`/setup`), `First run / Repository`, `First run / First project` |
| Home | `Home` (`/home`), `All projects` (`/home/projects`), `Bell menu`, `Switcher` |
| Project | `Board` (`/p/console/board`), `Board / Empty` (`/p/phone/board`), `Sprint` (`/p/console/sprint/sp1`), `Task`, `Team`, `New project`, `Project settings` (`/p/console/settings`) |
| Workflow | `Phases` (`/p/console/workflow`), `Review rounds` (`/p/console/workflow/review`), `Test runs` (`/p/console/workflow/runs`), `End result` (`/p/console/workflow/result`), `Workflow settings` (`/p/console/workflow/settings`) |
| Mocks | `Screens` (`/p/phone/mocks`), `Screen` (`/p/phone/mocks/screen/requests`), `Changes` (`/p/phone/mocks/changes`), `Data` (`/p/phone/mocks/data`), `Components` (`/p/phone/mocks/components`) |
| Conversations | `Chat` (`/p/console/chat`), `Messages` (`/p/console/messages`), `Messages / Waiting for a reply` (`/p/console/messages/waiting`), `Agents` (`/p/console/agents`) |
| Code | `Terminal` (`/p/console/terminal`), `Git / Changes` (`/p/console/git`), `Git / History`, `Git / Conflicts`, `Merge review` |
| Repository | `Repository` (`/r/lgtm`), `Repository design` (`/r/lgtm/design`) |
| Service | `Machines` (`/machines`), `Pair machine`, `Add repository`, `Subscriptions` (`/subscriptions`), `Add subscription`, `Notifications` (`/notifications`), `Service settings` (`/settings`) |

A frame without an address is a state or a dialog that the mock opens from the screen above
it. Phone layouts are added as `/ Phone` states as they are drawn.

### Components for LGTM Studio

The fixed groups come first. LGTM Studio adds two groups of its own: Agents, and Code. The words "in the file"
mark a component that is in `design/lgtm.fig` today. The others exist only in the mock's
code.

| Group | Components |
|---|---|
| Overview | One instance of every component below |
| Actions | Button (in the file), Icon button, Inline link (in the file) |
| Inputs | Text input, Text area, Select, Switch, Checkbox, Segmented control (in the file), Search field |
| Navigation | Sidebar row, Tree row, Tabs, Breadcrumbs, Top bar |
| Overlays | Menu, Dialog, Toast, Tooltip |
| Status | Status dot (in the file), Task state (in the file), Connection status (in the file), Attention number (in the file), Badge, Tag, Meter, Progress, Callout, Empty state |
| Data | Table, List row, Description list, Keyboard key |
| Agents | Avatar, Agent row (in the file), Agent line, Message, Composer, Request block, Tool line |
| Code | Diff, Terminal line |

### Palette for LGTM Studio

| Item | Content |
|---|---|
| Colour | Groups Surfaces, Text, Action, States, Diff and Terminal |
| Type | The `text-xs` to `text-xl` and `text-input` sizes, the three weights, the two leadings, the measure, and the three font families |
| Space and density | `space-1` to `space-12`, then `row`, `control`, `control-lg`, `inset`, `gap-group`, `topbar` and `tabrow` in Compact and Regular |
| Shape | `radius-sm`, `radius-md`, `radius-lg`, `radius-pill`, `shadow-1` and `shadow-2` |
| Motion | `motion-fast`, `motion-slow` and `ease` |
| Icons | The Lucide icons in `design/mock/js/icons.js` |

## What `design/lgtm.fig` holds today

The file was saved by OpenPencil on 2026-11-08. It has three pages.

| Page | Content |
|---|---|
| `Components` | 8 components: 7 component sets in frames with 25 variants, and 1 single component, `Attention number`. That is 26 components in all. |
| `Screens` | 8 instances, one of each component. It holds no screen frames. |
| OpenPencil's internal page | 1 variable collection, `Color`, with the modes Field and Dusk and 15 colour variables |

The 8 components, with their variants, are:

| Component | Variants | Group under this standard |
|---|---|---|
| Button | Kind=Primary or Secondary, by State=Default, Hover or Disabled (6) | Actions |
| Inline link | State=Default or Hover (2) | Actions |
| Segmented control | Selected=First (1) | Inputs |
| Status dot | Status=Working, Waiting, Idle, Failed or Stopped (5) | Status |
| Task state | State=Up next, In progress, In review, Done or Blocked (5) | Status |
| Connection status | Status=Live, Waiting or Offline (3) | Status |
| Attention number | None (1) | Status |
| Agent row | Status=Waiting, Running or Idle (3) | Agents |

The 15 colour variables are bg, surface, raised, sidebar, text, muted, primary,
primary-contrast, accent, success, warn, error, focus, line and selected. Their values match
`design/tokens.css` exactly in both modes.

## What LGTM Studio's file must change to meet the standard

These are findings. They are not done, and this standard does not do them.

1. The `Components` page splits into `Components / Actions`, `Components / Inputs`,
   `Components / Status` and `Components / Agents`.
2. The `Screens` page is deleted. Its 8 instances are the Overview, which the page now
   builds on its own.
3. The `Screens / <Flow>` pages are created, one for each flow in the Screens table above.
4. The `Agent row` variants show the name "Rowan", which is an invented personal name. They
   must show a role name, such as "Builder 1".
5. The file has 15 colours. The mock's `design/mock/css/tokens.css` has 38 colours in Field,
   with retuned values. Until the file catches up, the Colour table marks 23 rows "Only in
   code". It also marks the 13 shared colours whose values were retuned. Only `surface`
   and `primary-contrast` still agree.
6. The file has no type, space, density, shape or motion variables. Until it does, those
   Palette items show the CSS values marked "Only in code".
7. The colour variables gain their groups, such as `color/Surfaces/bg`. The CSS names do not
   change.
