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
  intro: {
    price: number;
    unit: string;
    units: number;
    cycles?: number;
    priceString?: string;
  } | null = null,
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
        priceString: intro.priceString ?? 'intro',
        cycles: intro.cycles ?? 1,
        period: `P${intro.units}D`,
        periodUnit: intro.unit,
        periodNumberOfUnits: intro.units,
      },
    },
  };
}

/** The same package with its own store product id (a separate product, D57). */
export function withProductId<P extends ReturnType<typeof fakePackage>>(pkg: P, id: string): P {
  return { ...pkg, product: { ...pkg.product, identifier: id } };
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
  day3Amount = 30,
  exit30Amount = 42,
}: {
  trialDays?: number | null;
  extra?: boolean;
  monthlyAmount?: number;
  yearlyAmount?: number;
  day3Amount?: number;
  exit30Amount?: number;
} = {}) {
  return {
    current: null,
    all: {
      ...(extra
        ? {
            // D52/D57 day-3 gift (MOB-64, MOB-76): yearly with a paid first-year intro price
            // (30 of 60 = 50%).
            day3: {
              identifier: 'day3',
              availablePackages: [
                fakePackage(
                  '$rc_annual',
                  PACKAGE_TYPE.ANNUAL,
                  'Y-PRICE',
                  { price: day3Amount, unit: 'YEAR', units: 1, priceString: 'O-PRICE' },
                  null,
                  { price: yearlyAmount },
                ),
              ],
            },
            // D57 exit offer (MOB-76): `yearly_exit30`, paid first-year intro (42 of 60 = 30%).
            exit30: {
              identifier: 'exit30',
              availablePackages: [
                withProductId(
                  fakePackage(
                    '$rc_annual',
                    PACKAGE_TYPE.ANNUAL,
                    'Y-PRICE',
                    { price: exit30Amount, unit: 'YEAR', units: 1, priceString: 'X-PRICE' },
                    null,
                    { price: yearlyAmount },
                  ),
                  'yearly_exit30',
                ),
              ],
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
