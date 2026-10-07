# Vendored shadcn Tailwind utilities

Source: shadcn@4.21.0 npm package, `tailwind.css` export.
MIT license retained in shadcn-LICENSE.txt. CSS copied byte-for-byte; SHA-256: `bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a`.

Only use was the CSS import in src/index.css. Removing the CLI dependency does not remove the existing local UI components. This follows the supported shadcn eject pattern, using the exact locked package rather than an unpinned CLI.

Compiled application CSS before/after was byte-identical. Future upstream utility changes require explicit review; do not restore an unpinned CLI dependency automatically.

Documentation: https://ui.shadcn.com/docs/cli#eject
