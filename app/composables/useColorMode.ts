// Shared singleton state so all composable consumers see the same mode
const _mode = ref<"light" | "dark">("light");
let _initialized = false;

export function useColorMode() {
  function init() {
    if (import.meta.server || _initialized) return;
    _initialized = true;
    const saved = localStorage.getItem("color-mode");
    if (
      saved === "dark" ||
      (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      _mode.value = "dark";
    }
    apply();
  }

  function toggle() {
    _mode.value = _mode.value === "light" ? "dark" : "light";
    localStorage.setItem("color-mode", _mode.value);
    apply();
  }

  function apply() {
    if (import.meta.server) return;
    document.documentElement.classList.toggle("dark", _mode.value === "dark");
  }

  return { mode: _mode, toggle, init };
}
