export function buildReferralAnalytics({ referrals, profiles, investments, investmentPlans }) {
  const profileRows = Array.isArray(profiles) ? profiles : Object.values(profiles ?? {});
  const referralMap = new Map();

  for (const referral of referrals ?? []) {
    const referrerId = referral.referrer_id;
    const referrerProfile = profileRows.find((profile) => profile.id === referrerId);
    const referralKey = referrerId ?? "unknown";
    if (!referralMap.has(referralKey)) {
      referralMap.set(referralKey, {
        referrerId,
        referralCode: referrerProfile?.referral_code ?? null,
        referrerName: referrerProfile?.full_name ?? null,
        joinedUsers: 0,
        totalInvestedAmount: 0,
        planNames: [],
        investmentCount: 0,
        referredUsers: [],
      });
    }

    const entry = referralMap.get(referralKey);
    if (!entry.referredUsers.some((user) => user.id === referral.referred_id)) {
      entry.referredUsers.push({ id: referral.referred_id, name: profileRows.find((profile) => profile.id === referral.referred_id)?.full_name ?? null });
    }
  }

  for (const referralEntry of referralMap.values()) {
    referralEntry.joinedUsers = referralEntry.referredUsers.length;

    const relatedInvestments = (investments ?? []).filter((investment) => referralEntry.referredUsers.some((user) => user.id === investment.user_id));
    referralEntry.investmentCount = relatedInvestments.length;
    referralEntry.totalInvestedAmount = relatedInvestments.reduce((sum, investment) => sum + Number(investment.plan_amount || 0), 0);
    referralEntry.planNames = Array.from(new Set(relatedInvestments.map((investment) => investmentPlans?.[investment.plan_id] || investment.plan_id || "Unknown"))); 
  }

  return Array.from(referralMap.values()).sort((a, b) => b.totalInvestedAmount - a.totalInvestedAmount);
}
