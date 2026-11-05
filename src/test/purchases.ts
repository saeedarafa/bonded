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
  addCustomerInfoUpdateListener: jest.Mock;
  removeCustomerInfoUpdateListener: jest.Mock;
};

/** A RevenueCat package as the SDK returns it. Prices are opaque test strings, never real ones. */
export function fakePackage(
  identifier: string,
  packageType: PACKAGE_TYPE,
  priceString: string,
  intro: { price: number; unit: string; units: number; cycles?: number } | null = null,
  pricePerMonthString: string | null = null,
) {
  return {
    identifier,
    packageType,
    product: {
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

/** `default` offering: yearly with a 7-day free intro (store-given), monthly without. */
export function fakeOfferings({
  trialDays = 7,
  extra = true,
}: { trialDays?: number | null; extra?: boolean } = {}) {
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
          fakePackage('$rc_monthly', PACKAGE_TYPE.MONTHLY, 'M-PRICE'),
          fakePackage(
            '$rc_annual',
            PACKAGE_TYPE.ANNUAL,
            'Y-PRICE',
            trialDays ? { price: 0, unit: 'DAY', units: trialDays } : null,
            'PM-PRICE',
          ),
        ],
      },
    },
  };
}
