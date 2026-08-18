/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, EyeOff } from "lucide-react";

/**
 * The eye toggle that sits inside a password field.
 *
 * Typing a password blind is where wrong-password errors come from — the user cannot tell a typo
 * from a forgotten password, so they retry the same wrong string until the throttle locks them out.
 * Revealing what they themselves typed, on their own device and only while they hold the control,
 * costs nothing an onlooker could not already get from the keyboard.
 *
 * The field it decorates needs `relative` on its wrapper and `pr-12` on the input, so the text
 * never runs under the button.
 */
export function RevealPasswordButton({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      // Not in the tab order: keyboard users move label → field → next field, and a control that
      // only changes how the field looks should not interrupt that.
      tabIndex={-1}
      onClick={onToggle}
      aria-label={shown ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      aria-pressed={shown}
      className="absolute right-1 top-1 grid h-9 w-9 place-items-center text-beige-kem/70 transition hover:text-beige-kem"
    >
      {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
    </button>
  );
}
