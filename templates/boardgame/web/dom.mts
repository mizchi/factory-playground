export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, style?: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (style) node.className = style;
  return node;
}
