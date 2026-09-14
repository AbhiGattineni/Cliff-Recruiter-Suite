// The light/dark switch.
//
// Two states on screen, not three. The stored preference has a "system" value,
// but there is no button for it: someone who opens this menu has an opinion,
// and offering "follow my OS" as a third click mostly produces people who
// cannot tell which of three states they are in. System remains the default
// until the first click, and Preferences could expose a way back to it later
// if anyone ever asks.

import { useTheme } from "../context/ThemeContext";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className={`theme-toggle ${className}`.trim()}
      // The control's own name changes with its state, so the label has to say
      // what clicking does rather than what it is.
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
