import globals from "globals";

export default [
    {
        files: ["**/*.js"],
        ignores: ["src/webview/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.commonjs,
                ...globals.node,
                ...globals.mocha,
            },

            ecmaVersion: 2022,
            sourceType: "module",
        },

        rules: {
            "no-const-assign": "warn",
            "no-this-before-super": "warn",
            "no-undef": "warn",
            "no-unreachable": "warn",
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
            "constructor-super": "warn",
            "valid-typeof": "warn",
        },
    },
    {
        files: ["src/webview/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.browser,
                acquireVsCodeApi: "readonly",
                marked: "readonly",
                hljs: "readonly",
            },

            ecmaVersion: 2022,
            sourceType: "script",
        },

        rules: {
            "no-const-assign": "warn",
            "no-this-before-super": "warn",
            "no-undef": "warn",
            "no-unreachable": "warn",
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
            "constructor-super": "warn",
            "valid-typeof": "warn",
        },
    }
];