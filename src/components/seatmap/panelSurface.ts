/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How a panel in the editor's right rail is drawn.
 *
 * Every one of them used to carry `border-2 border-beige-kem bg-surface-2 p-4` of its own, and they
 * stack — so the rail became a column of heavy 2px boxes, each one nested inside the collapsible
 * group that already had a box of its own. Box inside box inside box, six deep down the rail.
 *
 * Mature designers do not do this. Driving the seats.io Chart Designer, its object inspector is ONE
 * surface: no card borders at all, sections separated by a heading and a hairline rule, and the only
 * real edge is where the panel meets the canvas. That is the model here — the rail owns the edge, and
 * a panel inside it is content rather than a container.
 *
 * Floating things keep their borders and are deliberately NOT changed: a popover or a modal sits over
 * the canvas and needs an edge to say where it ends.
 */
export const RAIL_PANEL = "px-1";
