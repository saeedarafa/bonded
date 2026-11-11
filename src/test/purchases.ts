import Purchases, { PACKAGE_TYPE } from 'react-native-purchases';

/** The jest.fn()s behind `react-native-purchases` (src/test/setup.ts). */
export const purchasesMock = Purchases as unknown as {
  configure: jest.Mock;
  setLogLevel: jest.Mock;
  logIn: jest.Mock;
  logOut: jest.Mock;
  getOfferings: jest.Mock;
  purchasePackage: jest.Mock;
  restorePurchases: jest.Mock;
  checkTrialOrIntroductoryPriceEligibility: jest.Mock;
  addCustomerInfoUpdateListener: jest.Mock;
  removeCustomerInfoUpdateListener: jest.Mock;
};

/**
 * A RevenueCat package as the SDK returns it. Price strings are opaque test strings, never real
 * ones; `price` (the number) only feeds the save % and per-person math.
 */
export function fakePackage(
  identifier: string,
  packageType: PACKAGE_TYPE,
  priceString: string,
  intro: { price: number; unit: string; units: number; cycles?: number } | null = null,
  pricePerMonthString: string | null = null,
  { price = 0, currencyCode = 'XTS' }: { price?: number; currencyCode?: string } = {},
) {
  return {
    identifier,
    packageType,
    product: {
      identifier: `product${identifier}`,
      price,
      currencyCode,
      priceString,
      pricePerMonthString,
      introPrice: intro && {
        price: intro.price,
        priceString: 'intro',
        cycles: intro.cycles ?? 1,
        period: `P${intro.units}D`,
        periodUnit: intro.unit,
        periodNumberOfUnits: intro.units,
      },
    },
  };
}

/**
 * `default` offering: yearly with a 7-day free intro (store-given), monthly without. Amounts are in
 * XTS (the ISO "testing" currency): 12 × 10 vs 60 = save 50%, 60 ÷ 24 = 2.50 per person a month.
 */
export function fakeOfferings({
  trialDays = 7,
  extra = true,
  monthlyAmount = 10,
  yearlyAmount = 60,
}: {
  trialDays?: number | null;
  extra?: boolean;
  monthlyAmount?: number;
  yearlyAmount?: number;
} = {}) {
  return {
    current: null,
    all: {
      ...(extra
        ? {
            // D28 offerings (MOB-22): their own store prices, never computed in the app.
            intro: {
              identifier: 'intro',
              availablePackages: [
                fakePackage('$rc_annual', PACKAGE_TYPE.ANNUAL, 'I-PRICE', {
                  price: 0,
                  unit: 'WEEK',
                  units: 1,
                }),
              ],
            },
            winback: {
              identifier: 'winback',
              availablePackages: [fakePackage('$rc_annual', PACKAGE_TYPE.ANNUAL, 'W-PRICE')],
            },
          }
        : {}),
      default: {
        identifier: 'default',
        availablePackages: [
          fakePackage('$rc_monthly', PACKAGE_TYPE.MONTHLY, 'M-PRICE', null, null, {
            price: monthlyAmount,
          }),
          fakePackage(
            '$rc_annual',
            PACKAGE_TYPE.ANNUAL,
            'Y-PRICE',
            trialDays ? { price: 0, unit: 'DAY', units: trialDays } : null,
            'PM-PRICE',
            { price: yearlyAmount },
          ),
        ],
      },
    },
  };
}
