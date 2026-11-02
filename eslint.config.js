// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.expo/**',
      'ios/**',
      'android/**',
      'expo-env.d.ts',
      // Owned by other agents; linted by their own tooling.
      'supabase/**',
      'qa/**',
      'scripts/**',
      'design-handoff/**',
      'docs/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      '.github/**',
      '.engram/**',
      'src/types/database.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // MOB-03: tokens only. Colours, font sizes and font names come from src/ui (useTheme(), type.*).
  // src/ui/theme.ts is the one file that maps tokens.json to code.
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/ui/theme.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...tokenOnlyRules()],
    },
  },
]);

/** Exported so later rule sets (e.g. MOB-29 raw JSX strings) can extend no-restricted-syntax without dropping these. */
function tokenOnlyRules() {
  const colorMsg = 'Hard-coded colour: use a theme token (useTheme().colors.*), see DESIGN.md §2.';
  return [
    {
      selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
      message: colorMsg,
    },
    { selector: 'Literal[value=/^(?:[rR][gG][bB][aA]?|[hH][sS][lL][aA]?)\\(/]', message: colorMsg },
    {
      selector:
        'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])|(?:[rR][gG][bB][aA]?|[hH][sS][lL][aA]?)\\(/]',
      message: colorMsg,
    },
    {
      selector: 'Property[key.name=/[cC]olor$/] > Literal[value=/^(?!transparent$)[a-zA-Z]+$/]',
      message: colorMsg,
    },
    {
      selector: 'JSXAttribute[name.name=/[cC]olor$/] Literal[value=/^(?!transparent$)[a-zA-Z#]/]',
      message: colorMsg,
    },
    {
      selector: 'Property[key.name=/^(?:fontSize|lineHeight)$/][value.type="Literal"]',
      message: 'Raw font size: use a type token (type.body, type.h2, ...), see DESIGN.md §3.',
    },
    {
      selector: 'Property[key.name="fontFamily"][value.type="Literal"]',
      message: 'Raw font name: use a type token (type.*) or fonts.* from src/ui/theme.ts.',
    },
  ];
}

module.exports.tokenOnlyRules = tokenOnlyRules;
