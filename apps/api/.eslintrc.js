module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          'alerts',
          'audit',
          'auth',
          'dashboard',
          'devices',
          'growth',
          'harvest',
          'ingest',
          'maintenance',
          'meta',
          'phase2',
          'redis',
          'reports',
          'seed',
          'sheds',
          'storage',
        ].flatMap((name) => [
          {
            group: [`./${name}/*`, `../${name}/*`, `../../${name}/*`],
            message: `只能从 ${name} 模块公共入口导入，禁止深入内部文件`,
          },
        ]),
      },
    ],
  },
};
