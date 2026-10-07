// DSI starter documents. Each gym edits these before using them; they are a starting point, not legal advice.
// Placeholders are filled in when a member signs: {{gym}} {{gym_address}} {{member}} {{date}}
// and, on the contract, {{plan}} {{price}} {{interval}} {{commitment}}.

export const STARTERS = {
  waiver: {
    title: 'Waiver and General Release',
    body: `WAIVER, RELEASE OF LIABILITY AND ASSUMPTION OF RISK

Gym: {{gym}}, {{gym_address}}
Participant: {{member}}
Date: {{date}}

Please read this carefully. By signing it you give up certain legal rights.

1. The activity. I want to take part in classes, open gym, coaching, competitions and other fitness activities at or organized by {{gym}} (the "Gym"), including strength training, Olympic lifting, gymnastics, running, rowing, jumping and high intensity conditioning, and to use the Gym's equipment and facilities (together, the "Activities").

2. I understand the risks. The Activities are physically demanding and carry inherent risks, including muscle strains and tears, sprains, broken bones, joint and back injuries, heat illness, cardiac events, falling or dropped weights and equipment, contact with other people, equipment that fails, and in rare cases permanent disability or death. Some risks cannot be removed without changing the nature of the Activities.

3. I assume the risk. I take part voluntarily. I knowingly assume all risks of the Activities, known and unknown, including risks that come from the ordinary negligence of the Gym, its owners, coaches, employees and volunteers.

4. My health. I confirm I am physically able to take part. I have been advised to talk with a physician before starting any exercise program. I will tell a coach about any injury, condition or medication that could affect my safety, and I will stop and tell a coach if I feel pain, dizziness or shortness of breath.

5. Release. To the fullest extent the law allows, I release, waive and agree not to sue the Gym, its owners, officers, coaches, employees, volunteers and landlord (the "Released Parties") for any injury, loss or damage to me or my property arising from the Activities or my presence at the Gym, including claims caused by the ordinary negligence of the Released Parties. This release does not cover gross negligence or intentional misconduct.

6. Indemnity. I will defend and hold harmless the Released Parties from claims made by others that result from my own conduct at the Gym.

7. Medical care. If I am hurt or ill, I authorize the Gym to call emergency services and to arrange first aid or medical treatment for me. I am responsible for the cost of that care.

8. Rules and equipment. I will follow the coaches' instructions and the Gym's posted rules, use equipment only as taught, put equipment away, and lift within my ability. The Gym may remove me from an Activity at any time for safety.

9. Photos and video. The Gym may take photos or video during classes and events and use them to promote the Gym. I can opt out by telling the Gym in writing.

10. Personal property. The Gym is not responsible for lost, stolen or damaged personal items.

11. Severability and law. If any part of this agreement is found unenforceable, the rest stays in effect. This agreement is governed by the laws of the state where the Gym is located.

12. Duration. This waiver covers every visit, now and in the future, until I revoke it in writing.

I have read this waiver, I understand it, and I sign it voluntarily. I am at least 18 years old, or a parent or guardian is signing for me.`,
  },
  contract: {
    title: 'Membership Agreement',
    body: `MEMBERSHIP AGREEMENT

Gym: {{gym}}, {{gym_address}}
Member: {{member}}
Date: {{date}}
Membership: {{plan}}
Price: {{price}} {{interval}}
Commitment: {{commitment}}

1. Membership. This agreement gives the Member access to the classes and facilities included in the membership named above, under the Gym's posted schedule and rules. Signing the Gym's Waiver and General Release is required before using the Gym.

2. Payment. The Member authorizes the Gym to charge the card on file the price above when the membership starts and then each billing period ({{interval}}) until the membership ends. Payments are processed by Stripe for the Gym. Prices do not include sales tax where it applies.

3. Missed payments. If a payment fails, the Gym may retry the card, and the membership may be paused until the balance is paid. The Gym may charge a reasonable late fee where permitted by law.

4. Commitment and renewal. If a commitment is listed above, the Member agrees to pay for at least that many months. After any commitment, the membership continues month to month (or year to year for yearly plans) until cancelled.

5. Cancelling. The Member may cancel at any time after any commitment by telling the Gym in writing (email is fine) or by stopping autopay in their DSI account. Cancellation takes effect at the end of the current paid period. Payments already made are not refunded except where the law requires.

6. Freezes. The Gym may allow the Member to freeze the membership for travel, injury or medical reasons. Ask the Gym for its freeze policy.

7. Price changes. The Gym will give at least 30 days notice before changing the price of an ongoing membership. The Member may cancel before the new price takes effect.

8. Gym changes. Class times, coaches and programming can change. If the Gym closes permanently, unused prepaid amounts will be refunded on a prorated basis.

9. Conduct. The Gym may suspend or end a membership for unsafe behavior, harassment, damage to property or repeated violation of the rules, with a prorated refund of any prepaid amount.

10. Your cancellation rights. The Member may cancel this agreement within three business days of signing it and receive a full refund, as required in many states for health club contracts.

11. Entire agreement. This agreement and the Waiver and General Release are the whole agreement between the Member and the Gym about the membership. It is governed by the laws of the state where the Gym is located.

By signing, the Member agrees to these terms and authorizes the recurring charges described above.`,
  },
};

// Fill placeholders for display and for the record kept with a signature.
export function fillDoc(body, v) {
  return String(body).replace(/\{\{(\w+)\}\}/g, (m, k) => (v[k] != null && v[k] !== '' ? String(v[k]) : m));
}
