import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'assets', 'relay/.wrangler', 'relay/node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Phân vùng: /shared không được phụ thuộc vào trình duyệt/Phaser/mạng
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['phaser', '@client/*', '@net/*', '@host/*', '../client/*', '../net/*', '../host/*'] },
      ],
    },
  },
);
