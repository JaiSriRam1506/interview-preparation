module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:react-hooks/recommended",
  ],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z_]" }],
  },
  ignorePatterns: ["dist/"],
  overrides: [
    {
      files: [
        "tailwind.config.js",
        "postcss.config.js",
        "vite.config.js",
        "*.config.js",
        "*.config.cjs",
      ],
      env: {
        node: true,
        browser: false,
      },
    },
  ],
};
