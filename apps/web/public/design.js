// /design: clone the light column into a dark one, so every component is
// shown in both themes from one source. Cloned nodes, never HTML strings.
const light = document.getElementById("light");
const dark = light.cloneNode(true);
dark.id = "dark";
dark.setAttribute("data-theme", "dark");
dark.setAttribute("aria-label", "Dark theme");
for (const el of dark.querySelectorAll("[id]")) el.id = `${el.id}-dark`;
for (const el of dark.querySelectorAll("label[for]")) el.htmlFor = `${el.htmlFor}-dark`;
const label = dark.querySelector(".design-label");
if (label) label.textContent = "Dark";
light.after(dark);
