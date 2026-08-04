import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#root");

if (!root) {
  throw new Error("Renderer root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App locale="zh-CN" />
  </StrictMode>,
);
