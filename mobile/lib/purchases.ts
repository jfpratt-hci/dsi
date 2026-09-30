// DSI Pro purchases through RevenueCat (Apple and Google billing).
// Sales stay off until the RevenueCat keys are in app.json (extra.revenuecat). Until then Pro screens say "Coming soon".
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';

const keys = (Constants.expoConfig?.extra as any)?.revenuecat ?? {};
const KEY: string = Platform.OS === 'ios' ? keys.ios ?? '' : Platform.OS === 'android' ? keys.android ?? '' : '';
export const SALES_ON = !!KEY;
export const ENTITLEMENT = 'pro';

let configured = false;
export async function startPurchases(profileId: string, onPro: (on: boolean) => void) {
  if (!SALES_ON) return;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: KEY, appUserID: profileId });
      Purchases.addCustomerInfoUpdateListener(info => onPro(!!info.entitlements.active[ENTITLEMENT]));
      configured = true;
    } else {
      await Purchases.logIn(profileId);
    }
    const info = await Purchases.getCustomerInfo();
    onPro(!!info.entitlements.active[ENTITLEMENT]);
  } catch (e) {
    console.warn('Purchases start failed', e);
  }
}

export type Plan = { id: string; title: string; price: string; per: string; pkg: PurchasesPackage };

export async function loadPlans(): Promise<Plan[]> {
  if (!SALES_ON) return [];
  const off = await Purchases.getOfferings();
  const pkgs = off.current?.availablePackages ?? [];
  return pkgs.map(p => ({
    id: p.identifier,
    title: p.packageType === 'ANNUAL' ? 'Yearly' : p.packageType === 'MONTHLY' ? 'Monthly' : p.product.title,
    price: p.product.priceString,
    per: p.packageType === 'ANNUAL' ? 'a year' : p.packageType === 'MONTHLY' ? 'a month' : '',
    pkg: p,
  }));
}

export async function buy(plan: Plan): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
    return !!customerInfo.entitlements.active[ENTITLEMENT];
  } catch (e: any) {
    if (e?.userCancelled) return false;
    throw e;
  }
}

export async function restore(): Promise<boolean> {
  if (!SALES_ON) return false;
  const info = await Purchases.restorePurchases();
  return !!info.entitlements.active[ENTITLEMENT];
}

export async function manage() {
  if (SALES_ON) await Purchases.showManageSubscriptions().catch(() => {});
}

export async function stopPurchases() {
  if (SALES_ON && configured) await Purchases.logOut().catch(() => {});
}
