// /design: clone the light column into a dark one, so every component is
// shown in both themes from one source. Cloned nodes, never HTML strings.
import { displayName, displayCity } from "/labels.js";

// Display-case samples: filed form -> what the sheet shows, via textContent.
const cases = document.getElementById("display-case");
if (cases) {
  const samples = [
    ["ACME WELDING LLC", displayName],
    ["JOE'S HVAC INC.", displayName],
    ["O'BRIEN CNC", displayName],
    ["Mixed Case Inc", displayName],
    ["LA JUNTA", displayCity],
  ];
  for (const [filed, fn] of samples) {
    const dt = document.createElement("dt");
    dt.textContent = filed;
    const dd = document.createElement("dd");
    dd.textContent = fn(filed);
    cases.append(dt, dd);
  }
}

const light = document.getElementById("light");
const dark = light.cloneNode(true);
dark.id = "dark";
dark.setAttribute("data-theme", "dark");
dark.setAttribute("aria-label", "Dark theme");
for (const el of dark.querySelectorAll("[id]")) el.id = `${el.id}-dark`;
for (const el of dark.querySelectorAll("label[for]")) el.htmlFor = `${el.htmlFor}-dark`;
for (const attr of ["aria-labelledby", "aria-controls", "aria-describedby"]) {
  for (const el of dark.querySelectorAll(`[${attr}]`)) {
    el.setAttribute(attr, el.getAttribute(attr).split(/\s+/).map(id => `${id}-dark`).join(" "));
  }
}
for (const el of dark.querySelectorAll("[aria-label]")) el.setAttribute("aria-label", `${el.getAttribute("aria-label")} (dark)`);
const label = dark.querySelector(".design-label");
if (label) label.textContent = "Dark";
light.after(dark);
