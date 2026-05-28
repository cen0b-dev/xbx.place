export type DropdownOption = {
  value: string;
  label: string;
};

type CheckboxOptions = {
  id?: string;
  checked?: boolean;
  className?: string;
  attrs?: Record<string, string | undefined>;
  label?: string;
};

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function checkboxHtml(options: CheckboxOptions = {}): string {
  const { id, checked = false, className = "", attrs = {}, label } = options;
  const attrParts = [
    id ? `id="${escapeAttr(id)}"` : "",
    checked ? "checked" : "",
    ...Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${escapeAttr(key)}="${escapeAttr(value!)}"`)
  ]
    .filter(Boolean)
    .join(" ");

  const labelHtml = label ? `<span class="ui-check-label">${label}</span>` : "";

  return `
    <span class="ui-check${className ? ` ${className}` : ""}">
      <input type="checkbox" class="ui-check-input" ${attrParts} />
      <span class="ui-check-box" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
      ${labelHtml}
    </span>
  `;
}

export function dropdownMarkup(
  id: string,
  options: DropdownOption[],
  value: string,
  extraClass = ""
): string {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const menu = options
    .map((option) => {
      const selectedClass = option.value === selected?.value ? " is-selected" : "";
      return `<button type="button" class="ui-dropdown-option${selectedClass}" role="option" data-value="${escapeAttr(option.value)}" aria-selected="${option.value === selected?.value}">${option.label}</button>`;
    })
    .join("");

  return `
    <div class="ui-dropdown${extraClass ? ` ${extraClass}` : ""}" id="${escapeAttr(id)}" data-value="${escapeAttr(selected?.value ?? "")}">
      <button type="button" class="ui-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="ui-dropdown-value">${selected?.label ?? ""}</span>
        <i class="fa-solid fa-chevron-down ui-dropdown-chevron" aria-hidden="true"></i>
      </button>
      <div class="ui-dropdown-menu hidden" role="listbox">${menu}</div>
    </div>
  `;
}

function syncDropdownUi(dropdown: HTMLElement, value: string): void {
  const options = dropdown.querySelectorAll<HTMLButtonElement>(".ui-dropdown-option");
  const selected = [...options].find((option) => option.dataset.value === value) ?? options[0];
  if (!selected) return;

  dropdown.dataset.value = selected.dataset.value ?? "";
  const valueEl = dropdown.querySelector(".ui-dropdown-value");
  if (valueEl) valueEl.textContent = selected.textContent ?? "";

  options.forEach((option) => {
    const isSelected = option === selected;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function closeDropdown(dropdown: HTMLElement): void {
  dropdown.classList.remove("is-open");
  dropdown.querySelector(".ui-dropdown-trigger")?.setAttribute("aria-expanded", "false");
  dropdown.querySelector(".ui-dropdown-menu")?.classList.add("hidden");
}

function closeAllDropdowns(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".ui-dropdown.is-open").forEach((dropdown) => {
    if (dropdown !== except) closeDropdown(dropdown);
  });
}

function openDropdown(dropdown: HTMLElement): void {
  closeAllDropdowns(dropdown);
  dropdown.classList.add("is-open");
  dropdown.querySelector(".ui-dropdown-trigger")?.setAttribute("aria-expanded", "true");
  dropdown.querySelector(".ui-dropdown-menu")?.classList.remove("hidden");
}

export function getDropdownValue(id: string): string {
  return document.getElementById(id)?.dataset.value ?? "";
}

export function setDropdownValue(id: string, value: string): void {
  const dropdown = document.getElementById(id);
  if (!dropdown) return;
  syncDropdownUi(dropdown, value);
}

export function mountDropdown(id: string, onChange?: (value: string) => void): void {
  const dropdown = document.getElementById(id);
  if (!dropdown || dropdown.dataset.bound === "true") return;
  dropdown.dataset.bound = "true";

  const trigger = dropdown.querySelector<HTMLButtonElement>(".ui-dropdown-trigger");
  const menu = dropdown.querySelector<HTMLElement>(".ui-dropdown-menu");
  if (!trigger || !menu) return;

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (dropdown.classList.contains("is-open")) {
      closeDropdown(dropdown);
    } else {
      openDropdown(dropdown);
    }
  });

  menu.querySelectorAll<HTMLButtonElement>(".ui-dropdown-option").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      const value = option.dataset.value ?? "";
      syncDropdownUi(dropdown, value);
      closeDropdown(dropdown);
      onChange?.(value);
    });
  });
}

export function initFormControls(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(".ui-dropdown").forEach((dropdown) => {
    if (dropdown.id) mountDropdown(dropdown.id);
  });
}

let globalListenersBound = false;

export function bindFormControlGlobals(): void {
  if (globalListenersBound) return;
  globalListenersBound = true;

  document.addEventListener("click", () => closeAllDropdowns());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllDropdowns();
  });
}

export const SORT_OPTIONS: DropdownOption[] = [
  { value: "rating", label: "Best Rated" },
  { value: "name", label: "A-Z" },
  { value: "newest", label: "Newest" }
];

export const REGION_OPTIONS: DropdownOption[] = [
  { value: "all", label: "All Regions" },
  { value: "USA", label: "USA" },
  { value: "Europe", label: "Europe" },
  { value: "Japan", label: "Japan" },
  { value: "World", label: "World / Region Free" }
];
