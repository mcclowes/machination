import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', 'ios/**', 'android/**', 'dist/**', 'dist-server/**', 'website/**', '**/*.test.*'] },
  {
    files: ['App.tsx', 'src/**/*.{ts,tsx}', 'server/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': hooks, '@typescript-eslint': tseslint.plugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
    },
  },
  {
    files: ['src/contracts/**/*.ts', 'src/online/network.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
];
