# Bottom panel research for the seat-map editor

Research date: 2026-08-23

Scope: public first-party documentation and release notes for seat-map, floor-plan, CAD, and visual-layout editors. This note distinguishes documented product behaviour from recommendations for TixHub. It does not infer UI placement where a source does not document it.

## Observed patterns

### Seats.io Chart Designer and renderer

- Seats.io exposes labeling as its own Designer capability and describes context actions (copy, cut, paste, flip, align, and similar operations) separately from object properties. Its Designer also has a first-time tutorial that remains reachable from the help menu. This supports treating labeling and help as contextual workflows rather than permanent canvas-view settings. [Seats.io Designer feature configuration](https://docs.seats.io/docs/embedded-designer/configuration-features/)
- Seats.io's current release notes document applying a seat-labeling algorithm to only a subset of a row, Shift-based range selection, and Alt/Option temporarily disabling all snapping. These are contextual and modifier-driven editing behaviours. [Seats.io changelog](https://docs.seats.io/changelog/)
- Seats.io documents a total-seat message that includes general-admission capacity. A chart-wide total therefore represents total places/capacity, not only rendered chair glyphs. [Seats.io changelog](https://docs.seats.io/changelog/)
- Seats.io provides reset-view and zoom-to-object/selection/section operations. Its renderer displays a zoom-out/reset affordance after zooming, and shows a minimap only when zoomed into a chart with sections. Navigation affordances appear when they become useful instead of remaining permanently prominent. [Renderer methods](https://docs.seats.io/docs/renderer/rendered-chart-methods/), [mobile zoom-out control](https://docs.seats.io/docs/renderer/config-showzoomoutbuttononmobile/), [minimap](https://docs.seats.io/docs/renderer/config-showminimap/)
- Seats.io warns that changing technical labels can affect existing bookings and offers displayed labels as the safer presentation layer. Numbering/labeling is therefore materially different from a reversible display toggle. [Seats.io object labels](https://docs.seats.io/docs/api/objects/)

### Prismm floor-plan editor

- Prismm places pan, reset-view, zoom-out, and zoom-in controls together in the lower-right corner of the floor-plan design area. [Prismm pan, reset, and zoom](https://support.prismm.com/hc/en-us/articles/10522657518876-Floorplan-Layouts-Pan-Reset-Zoom-Display)
- Prismm groups grid visibility with its display controls; its documentation describes adding/removing the grid and its values as one grid action. [Prismm grid lines](https://support.prismm.com/hc/en-us/articles/11500302361628-Floorplan-Layouts-Use-Grid-Lines)
- Prismm also groups seat count, assigned-seat state, table names/numbers, and occupancy under display settings, separate from navigation. [Prismm display settings](https://support.prismm.com/hc/en-us/articles/11500420995996-Floorplan-Layouts-Manage-Display-Settings)

### AutoCAD

- AutoCAD's lower-right status bar is explicitly for frequently used drawing aids. Grid display, grid snap, and object snap are separate toggles; an active toggle has a filled/blue background. Associated settings are reached from an arrow or context menu rather than expanded continuously in the bar. [AutoCAD status bar](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DidYouKnow/files/GUID-0E4DE630-C2D9-4C0B-889B-16774D8AB1EE.htm)
- Grid spacing and snap spacing are distinct concepts. AutoCAD lets users open detailed settings from the status control and supports independent X/Y spacing, but keeps those details out of the default bar. [AutoCAD Snap and Grid settings](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-Core/files/GUID-66D637C9-6C47-420C-ADD1-83B64C73217A.htm)
- Cursor coordinates are optional and can be shown or hidden through status-bar customization. This prevents a continuously changing expert readout from consuming space for every user. [AutoCAD status bar](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DidYouKnow/files/GUID-0E4DE630-C2D9-4C0B-889B-16774D8AB1EE.htm)
- Grid snap and object snap are named separately because they constrain movement in different ways. AutoCAD's object-snap menu exposes the specific persistent snap targets. [AutoCAD status-bar quick reference](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-Core/files/GUID-E3B34B0A-EA98-45E9-937A-BF5FEF4152DB.htm), [2D Object Snap](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-Core/files/GUID-258AA5A6-39B2-4CFC-B4ED-C5F0DA3D2EE8.htm)

### SketchUp and LayOut

- SketchUp uses the middle of its status bar for instructions about the active tool and its modifier keys. Measurements are placed in a dedicated area, and values can be typed while drawing. [SketchUp interface](https://help.sketchup.com/en/sketchup/user-interface)
- LayOut documents a three-part bottom region: measurement input, active-tool status/tips (including optional modes), and a zoom dropdown with useful view commands. [SketchUp LayOut interface](https://help.sketchup.com/en/layout/introducing-layout-interface)

## Recommendations for the TixHub bottom panel

### 1. Use three stable zones

Organize the bar as:

1. **Left — view:** current zoom as a button/dropdown, plus zoom out, zoom in, and fit/reset. Coordinates can follow but should be optional or hidden below a practical width.
2. **Middle — drawing aids:** `Lưới` and `Bám` as compact state buttons. Give each a menu for details. Put grid size in the grid menu as one selected value, not four permanently visible numbers.
3. **Right — document/selection:** contextual selection summary followed by chart capacity, for example `2 khối · 100 ghế đã chọn` and `Tổng 450 chỗ`.

This gives the bottom edge a predictable scan order: view, drawing behaviour, result.

### 2. Add a complete zoom cluster

The current percentage is only a readout. Make it actionable and add `−`, `+`, and `Vừa sơ đồ`/reset beside it. Prismm and SketchUp both expose explicit view commands at the bottom, while Seats.io makes reset/zoom-to-content first-class operations.

### 3. Collapse grid step into a menu

Replace the always-visible `50 150 300 600` choices with one control such as `Lưới 150 ▾`. Its menu can contain:

- show grid;
- snap to grid;
- grid size, with human-readable equivalents such as `1 khoảng ghế`;
- any future custom value.

This keeps the bar compact and preserves the existing distinction between grid visibility and snap behaviour.

### 4. Rename and group snapping by behaviour

Use a `Bám ▾` group with independently checkable `Bám lưới` and `Bám tâm/cạnh khối`. A single active-state treatment should be visible without relying only on colour. Include the Alt/Option temporary-bypass hint in the menu/tooltip and in active-tool guidance while dragging.

### 5. Move auto-numbering out of the permanent status cluster

`Tự đánh số` changes saved labels when geometry is deleted or resized; it is not merely canvas state. Put it in the `Đánh nhãn` workspace or in the selected block's numbering section, with an explicit consequence such as `Tự dồn nhãn hàng sau khi xoá`. If it must remain globally accessible, place it under a `Đánh số ▾` menu and show a brief confirmation/explanation when first enabled.

### 6. Merge the separate hint row into contextual status

Use the wide middle portion for one active-tool sentence that changes with state, for example:

- `Chọn: kéo để chọn nhiều · Alt chọn từng ghế`;
- `Đang kéo: Alt tạm tắt bám`;
- `Vẽ đa giác: bấm để thêm điểm · Enter hoàn tất · Esc huỷ`.

This follows SketchUp's active-tool/modifier model and removes the appearance of two competing bottom bars.

### 7. Make selection and totals semantically precise

- When something is selected, state both kind and meaningful capacity: `1 khối · 50 ghế`, not only `1 khối`.
- When a row or individual seats are selected, keep the current specificity.
- If the document can contain GA areas, call the chart total `chỗ` or `sức chứa`, and include GA capacity; reserve `ghế` for actual seats. This matches Seats.io's documented total-place behaviour and avoids understating venue capacity.

### 8. Preserve expert data without making it the default focus

Keep cursor coordinates available, but allow them to collapse at narrower widths or live behind a small position readout. AutoCAD makes coordinates optional because they are useful for precision work but noisy for ordinary editing.

### Suggested compact desktop layout

```text
[−] [125% ▾] [+] [Vừa sơ đồ]  |  [Lưới 150 ▾] [Bám ▾]  |  Chọn: kéo để chọn nhiều · Alt chọn ghế  |  1 khối · 50 ghế  ·  Tổng 450 chỗ
```

At narrower widths, hide coordinates first, collapse the guidance to a help icon/tooltip second, and keep zoom, snap state, selection, and total capacity visible.

