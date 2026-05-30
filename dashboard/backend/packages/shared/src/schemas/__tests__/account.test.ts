import { describe, it, expect } from 'vitest';
import { AccountsFileSchema } from '../account.js';

const valid = {
  accounts: [
    {
      name: 'atomoh-main',
      account_id: '180294183052',
      region: 'ap-northeast-2',
      roles: {
        operator: {
          arn: 'arn:aws:iam::180294183052:role/DemoPlatformOperator',
          external_id_secret: '/demo-platform/external-ids/atomoh-main/operator',
        },
        terraformer: {
          arn: 'arn:aws:iam::180294183052:role/DemoPlatformTerraformer',
          external_id_secret: '/demo-platform/external-ids/atomoh-main/terraformer',
        },
      },
    },
  ],
};

describe('AccountsFileSchema', () => {
  it('parses valid accounts file', () => {
    const data = AccountsFileSchema.parse(valid);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].roles.operator.arn).toMatch(/DemoPlatformOperator$/);
  });

  it('rejects account_id not 12 digits', () => {
    expect(() =>
      AccountsFileSchema.parse({
        accounts: [{ ...valid.accounts[0], account_id: 'abc' }],
      }),
    ).toThrow();
  });

  it('rejects external_id_secret not starting with /demo-platform/', () => {
    expect(() =>
      AccountsFileSchema.parse({
        accounts: [
          {
            ...valid.accounts[0],
            roles: {
              ...valid.accounts[0].roles,
              operator: { ...valid.accounts[0].roles.operator, external_id_secret: 'wrong' },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('requires at least one account', () => {
    expect(() => AccountsFileSchema.parse({ accounts: [] })).toThrow();
  });
});
