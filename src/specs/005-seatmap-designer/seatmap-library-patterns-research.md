# Seat-map library patterns research

Research date: 2026-08-23

Scope: public first-party documentation and product pages for Seats.io, Ticket Tailor, Eventbrite, Cvent Event Diagramming, and adjacent design-library products. The sources expose different amounts of their authenticated UI, so this report separates documented behavior from recommendations for TixHub and does not invent undocumented screen details.

## Executive finding

Established products organize three concepts separately:

1. **Reusable spatial assets** — a venue chart, floor plan, or template.
2. **Event instances** — the live selling context that uses that asset and adds prices, inventory, holds, or attendees.
3. **Lifecycle and recovery** — draft/published state, archive, history, and duplication.

The strongest pattern for TixHub is therefore a library of venue-owned seat maps, with templates as a separate starting-point collection and live event usage shown as metadata. An organizer should not have to enter an event just to find or edit the underlying venue asset.

## How the products organize these concepts

### Seats.io: workspace-owned charts with explicit lifecycle metadata

- A workspace is the ownership container for charts and events; users may switch workspaces and copy floor plans between them. This is a clear account/workspace boundary rather than event ownership. [Seats.io workspaces](https://docs.seats.io/docs/api/workspaces/)
- Its chart collection is reverse-chronological and paginated. It supports name filtering, tag filtering, and optional expansion of linked events, validation, venue type, and zones. [Seats.io list charts](https://docs.seats.io/docs/api/list-all-charts/)
- A chart record exposes name, tags, archive state, lifecycle status, and published/draft thumbnail URLs. Statuses distinguish an unused chart, a published chart, and a published chart with newer draft changes. [Seats.io list charts](https://docs.seats.io/docs/api/list-all-charts/)
- Archive is a reversible secondary collection: archived charts leave the dashboard but remain recoverable; they cannot be permanently deleted. [Seats.io archive](https://docs.seats.io/docs/api/list-charts-in-the-archive/), [restore from archive](https://docs.seats.io/docs/api/move-a-chart-out-of-the-archive/)
- Duplication creates a new independent chart from the published version. It copies the name and tags but deliberately does not copy linked events or draft changes. Cross-workspace copying similarly excludes events and tags. [Seats.io copy chart](https://docs.seats.io/docs/api/copy-a-chart), [copy between workspaces](https://docs.seats.io/docs/api/charts-copy-chart-to-workspace/)

**Library implication:** use meaningful cards or rows that surface thumbnail, name, venue/workspace, lifecycle, validation, tags, and live usage. Keep archive as a tab/filter with Restore, and make “Duplicate” an asset action—not an event action.

### Ticket Tailor: seat charts are reusable assets created before events

- Ticket Tailor explicitly tells organizers to build the seating chart first, then create an event and choose a saved chart from a selector. The same chart can be reused across multiple events. [Ticket Tailor seated-event flow](https://help.tickettailor.com/en/articles/16213774-how-to-create-a-seated-event)
- The chart library lives under Box office Settings → Seating charts, while events live under a separate Events area. This is strong navigation separation between reusable configuration and live commerce. [Ticket Tailor simple chart guide](https://help.tickettailor.com/en/articles/10885119-how-to-create-a-simple-seating-chart)
- Creation begins by choosing a chart type—Simple, Sections and floors, or a traced floor plan—based on venue complexity. [Ticket Tailor getting started](https://help.tickettailor.com/en/articles/10883076-getting-started-with-our-seating-chart-tool), [seated-event flow](https://help.tickettailor.com/en/articles/16213774-how-to-create-a-seated-event)
- Ticket Tailor can reuse geometry by copying all content, creating a new chart, and pasting it, although this is a more manual workflow than a library-level Duplicate command. [Ticket Tailor copy a seating chart](https://help.tickettailor.com/en/articles/6007815-can-i-copy-a-seating-chart)
- Event-level duplication is a different action: the Events list uses a three-dot menu, supports one or multiple copies, and lets the user select draft or published status for the new event. [Ticket Tailor copy an event](https://help.tickettailor.com/en/articles/4967346-how-to-copy-an-event)

**Library implication:** the primary CTA should be “Create seat map,” opening a short choice among Template, Copy existing, and Blank/import. “Use for event” belongs to the completed chart, while event duplication should remain elsewhere.

### Eventbrite: venue-map reuse is embedded in event creation

- Reserved seating begins with a physical venue. When creating tickets, organizers can create a new venue map or reuse a map from a previous event—with or without its ticket settings. [Eventbrite reserved-seating setup](https://www.eventbrite.com/help/en-us/articles/683914/how-to-set-up-a-reserved-seating-event/)
- New-map creation offers a preset layout or blank canvas. At save time the organizer names the venue map and chooses whether it can be used for other events. [Eventbrite reserved-seating setup](https://www.eventbrite.com/help/en-us/articles/683914/how-to-set-up-a-reserved-seating-event/)
- The live event gains a separate Reserved seating dashboard showing sold, held, pending, and available seats. Published maps remain editable, but sold inventory restricts destructive geometry changes. [Eventbrite reserved seating management](https://www.eventbrite.com/help/en-us/articles/216108/)

**Library implication:** show linked-event count and active sales as operational metadata, but do not mix live seat availability into the reusable map card. If a map is used by selling events, destructive actions need a usage-aware warning or refusal.

### Cvent Event Diagramming: event → diagrams, backed by venue floor plans and setup templates

- Cvent starts from accurately scaled venue floor plans and describes a venue library of thousands of floor-plan options. Each event can contain multiple diagrams, making the event the working container and the venue plan the spatial source. [Cvent pricing/features](https://www.cvent.com/en/event-marketing-management/cvent-event-design-software/pricing)
- Cvent documents saving layouts, templates, and favorites, and explicitly supports saving, reusing, and cloning diagrams from past events. [Cvent design software](https://www.cvent.com/en/event-marketing-management/cvent-event-design-software), [Cvent pricing/features](https://www.cvent.com/en/event-marketing-management/cvent-event-design-software/pricing)
- Its product presentation separates a searchable catalog of actual venue inventory—tables, chairs, stages, AV, and décor—from the floor-plan canvas. [Cvent Event Diagramming](https://www.cvent.com/en/supplier-venue/event-diagramming-software)
- Collaboration state is part of the diagram: internal and external users may receive view or edit access, comment, and see updates in real time. [Cvent Event Diagramming](https://www.cvent.com/en/supplier-venue/event-diagramming-software)

**Library implication:** venue/floor plan should be prominent metadata, while templates and favorites reduce repeated setup. If TixHub later adds collaboration, owner and last editor become useful list metadata; they should not occupy the primary action area today.

### Adjacent benchmark: Miro and Figma

- Miro separates template discovery from normal boards. Its library has search, categories, featured content, previews, and sorting by recency, usage, views, or likes. A template detail page has one dominant “Use template” action and can create a new board or add to an existing one. [Miro templates](https://help.miro.com/hc/en-us/articles/360017572134-Templates), [Miroverse discovery](https://help.miro.com/hc/en-us/articles/27235125608082-Find-and-use-Miroverse-templates)
- Figma's file browser separates Recents, Drafts, Starred, Browse, and Trash. Search can be narrowed by resource type, location, and file type, then sorted by relevance, name, modification date, or creation date. [Figma file browser](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser), [Figma search and sort](https://help.figma.com/hc/en-us/articles/4422774037271-Search-for-files-folders-and-people)
- Figma treats thumbnails as functional recognition aids: every design file has one, derived from content by default, with an option to nominate a more useful frame. [Figma thumbnails](https://help.figma.com/hc/en-us/articles/23510169950871-Design-a-file-thumbnail)

**Library implication:** templates should be browsable, previewable starters—not status peers of live maps. Thumbnails should show the map geometry and remain visually dominant enough for recognition.

## Recommended TixHub information architecture

### Top-level navigation

Use three tabs with counts:

1. **Sơ đồ** — active reusable venue maps.
2. **Mẫu** — reusable starters with a single primary action, `Dùng mẫu`.
3. **Lưu trữ** — inactive maps with `Khôi phục` as the primary action.

Do not add a separate “Published” tab. Publication is a lifecycle status within active maps, and Seats.io shows why draft changes may coexist with a published version.

### Toolbar

Recommended order:

```text
[Search by map or venue] [Venue ▾] [Status ▾] [Sort: Recently updated ▾]     [+ Create seat map]
```

- Search across map name and venue name.
- Venue is the most useful domain filter because geometry belongs to a physical place.
- Status should include Draft, Published, and Published with pending changes.
- Default sort should be recently updated for daily work; include Name, Capacity, and Most used.
- Tags can wait until organizers have enough maps to justify another taxonomy.

### Active-map card or list row

Organize information in this hierarchy:

```text
┌──────────────── thumbnail ────────────────┐
│                                           │
└───────────────────────────────────────────┘
Map name                         [Status]
Venue name · Room/floor
450 seats · Used by 3 upcoming events
Updated 2 hours ago

[Open editor]                         [•••]
```

- **Thumbnail:** real geometry preview, not a decorative placeholder.
- **Identity:** map name first; venue and room second.
- **Operational metadata:** capacity, number of linked/upcoming events, last update.
- **Status:** Draft, Published, or Published + draft changes; error/warning indicators should be separate from lifecycle status.
- **Primary action:** `Open editor` for an active asset.
- **Overflow actions:** Preview, Use for event, Duplicate, Save as template, Rename, View history, Archive.
- **Destructive action:** Archive—not permanent delete—unless product retention rules explicitly require deletion.

For dense organizations, offer a list/grid view toggle later. Cards are preferable initially because floor-plan thumbnails carry more recognition value than text alone.

### Template card

A template is not a published/draft chart. Its card should contain:

- thumbnail;
- template name and shape/type, such as theater, banquet, classroom, or stadium section;
- estimated/default capacity or configurable range;
- owner scope: personal, organization, or built-in;
- one primary action: `Dùng mẫu`;
- secondary actions only for organizer-owned templates: Preview, Rename, Duplicate, Archive.

Using a template must always create a new map and ask for the destination venue. It must never edit the template in place.

### Creation flow

Use progressive disclosure rather than a large form:

1. Choose **Template**, **Copy existing**, or **Blank/import**.
2. Choose the destination venue and room.
3. Choose a source template/map if applicable; show its thumbnail, capacity, and venue compatibility.
4. Name the new map.
5. Create and open the editor.

Copying should copy geometry and display configuration, but not event links, live inventory, holds, attendees, or unpublished work unless explicitly selected. This matches Seats.io's separation of chart copies from linked events and drafts.

### Archive and history

- Archive should remove a map from the normal library without erasing it; provide Restore in the archive tab.
- Warn before archiving if upcoming/live events reference the map, and block it if the backend cannot preserve those links safely.
- Keep revision history behind `••• → Lịch sử phiên bản`; it is an expert recovery action, not card-level metadata.
- A restored revision should create a new draft over the current published version so the organizer can review before publishing.

## Priority changes for the current page

### P1

1. Keep **Sơ đồ / Mẫu / Lưu trữ** as distinct views, but make their semantics explicit: assets, starters, recovery.
2. Make the venue the second line of every map and add a venue filter.
3. Use a real preview thumbnail and make it the visual anchor of each card.
4. Show one primary card action. Move Rename, Duplicate, Save as template, History, and Archive into an overflow menu.
5. Represent `Published + draft changes` separately from plain Published; do not collapse it into a generic saved state.

### P2

1. Add search and sorting, defaulting to recently updated.
2. Show capacity, linked/upcoming event count, and last modified time consistently.
3. Make template use a creation flow that creates a new venue-owned asset.
4. Make archive reversible and usage-aware.

### P3

1. Add optional grid/list view.
2. Add favorites or recent maps when the library becomes large.
3. Add tags only when venue filtering and search are insufficient.
4. Add owner/last-editor metadata if collaborative editing ships.

## What to avoid

- Do not mix reusable maps and live event instances in one undifferentiated list.
- Do not present templates with Draft/Published lifecycle badges.
- Do not put six equally weighted buttons on every card.
- Do not use color alone to communicate draft, warning, and publication state.
- Do not copy event links, sold-seat state, holds, or attendees when duplicating a reusable map.
- Do not permanently delete an asset as the default cleanup action when archive and restore can preserve safety.
