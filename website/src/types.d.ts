/// <reference types="@docusaurus/module-type-aliases" />

declare module '*.module.scss' {
  const classes: Record<string, string>;
  export default classes;
}
