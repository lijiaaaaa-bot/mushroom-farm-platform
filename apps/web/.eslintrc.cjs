module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@nestjs/*', '**/apps/api/**', '**/entities/**'],
            message: 'web 只能依赖 @mushroom/contracts，不能进入 Nest 内部',
          },
        ],
      },
    ],
  },
};
