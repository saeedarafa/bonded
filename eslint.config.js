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
  // MOB-29: no raw user-visible strings; text comes from t() (src/i18n, catalogue in src/i18n/locales).
  // Both live in one no-restricted-syntax entry: a second entry for the same files would replace it.
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/ui/theme.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...tokenOnlyRules(), ...rawStringRules()],
    },
  },
  // Tests may render literal fixture text; they keep the token rules.
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}'],
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

/**
 * MOB-29: user-visible text goes through t(). Flags, in app/ and src/:
 * - text between JSX tags (`<Text>Hi</Text>`, `{'Hi'}`, `{`Hi ${x}`}`, `{ok ? 'Yes' : 'No'}`);
 * - string literals in visible props (title, label, placeholder, accessibilityLabel/Hint, *Label,
 *   *Title, *Text, *Hint, ...) whether JSX attributes or object properties (`options={{ title }}`);
 * - prose-looking literals (`"Hello"`, `"two words"`) in any other JSX prop except ids and routes.
 * Text without letters (`·`, `%`, `42`) is allowed. Exported so later rule sets can extend it.
 */
function rawStringRules() {
  const msg =
    'Raw user-visible string: put it in src/i18n/locales/en.json and use t(), see MOB-29.';
  const letter = '/\\p{L}/u';
  const visibleProp =
    '/^(?:title|label|placeholder|alt|text|message|subtitle|description|caption|hint|aria-label|aria-valuetext)$|(?:Label|Title|Text|Hint|Placeholder|Message)$/';
  const children = ':matches(JSXElement, JSXFragment) > JSXExpressionContainer';
  const nonVisibleProp =
    '/^(?:testID|nativeID|id|key|name|href|screenId|accessibilityRole|accessibilityLabelledBy|importantForAccessibility|source|uri)$/';
  // Direct shapes only (not descendants), so t('key') and t(`screens.${id}`) inside JSX stay legal.
  // For a parent selector P: P > 'text', P > `text ${x}`, and the same as a ?: or && / || branch.
  const textUnder = (p) => [
    `${p} > Literal[value=${letter}]`,
    `${p} > TemplateLiteral > TemplateElement[value.raw=${letter}]`,
    `${p} > :matches(ConditionalExpression, LogicalExpression) > Literal[value=${letter}]`,
    `${p} > :matches(ConditionalExpression, LogicalExpression) > TemplateLiteral > TemplateElement[value.raw=${letter}]`,
  ];
  const visibleAttr = `JSXAttribute[name.name=${visibleProp}]`;
  return [
    `JSXText[value=${letter}]`,
    ...textUnder(children),
    `${visibleAttr} > Literal[value=${letter}]`,
    ...textUnder(`${visibleAttr} > JSXExpressionContainer`),
    ...textUnder(`Property[key.name=${visibleProp}]`),
    `JSXAttribute:not([name.name=${nonVisibleProp}], [name.name=${visibleProp}]) > Literal[value=/^\\p{Lu}\\p{Ll}|\\p{L}\\s+\\p{L}/u]`,
  ].map((selector) => ({ selector, message: msg }));
}

module.exports.tokenOnlyRules = tokenOnlyRules;
module.exports.rawStringRules = rawStringRules;
