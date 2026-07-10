# Security Policy

Loop-Engineering is a workflow design and validation toolkit. It should not be treated as a permission system by itself.

## Supported Versions

Security fixes target the latest minor version.

## Reporting

If you find a security issue, open a private advisory or contact the maintainers before publishing details.

## Safety Defaults

The validator requires human-only gates for high-risk actions such as:

- Merging pull requests.
- Deploying production.
- Deleting data.
- Spending money.
- Changing permissions.

Adapters should preserve these gates and avoid adding unattended write behavior.
