// US Star Trucking LLC's actual transport agreement, as provided by Leo on
// 2026-07-24 (the same terms used in msgplane). Shown on the public /sign
// page and agreed to by the customer's typed signature.
//
// ONE place to edit — change the text here and every new signing page shows
// it. Only obvious paste artifacts were fixed (spacing, a merged clause split
// into 20/21); the legal wording is otherwise verbatim.

export const TERMS_VERSION = "2026-07-24";

// The letterhead facts on the customer's Order Invoice, exactly as they
// appear on the msgplane contract US Star sends today.
export const COMPANY = {
  name: "US Star Trucking LLC",
  website: "https://www.usstartruckingllc.com",
  mcNumber: "206532",
} as const;

// Signing links stop working this many days after the contract was last
// sent; resending refreshes the window.
export const CONTRACT_LINK_EXPIRY_DAYS = 14;

export function isContractLinkExpired(
  sentAt: string | null,
  signedAt: string | null
): boolean {
  if (signedAt || !sentAt) return false;
  return Date.now() - new Date(sentAt).getTime() > CONTRACT_LINK_EXPIRY_DAYS * 86_400_000;
}

export type TermsSection = {
  heading: string;
  intro?: string;
  clauses: { label: string; body: string; important?: boolean }[];
};

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: "Additional Information and Cancellation Fees",
    intro:
      "I agree to and authorize transport of the above vehicle as set forth above and in the attached terms & conditions.",
    clauses: [
      {
        label: "A",
        body: "Once the vehicle is picked up the deposit amount is due and charged to the credit card on file.",
      },
      {
        label: "B",
        body: "If for any reason Customer needs to change the pick-up date or delivery date or any other item on the order, and the Carrier has already been dispatched, Customer may be liable for a Rescheduling Fee. The broker will make all possible attempts to make changes without Customer incurring this charge, but if it is inevitable the charge stands.",
      },
      {
        label: "C",
        body: "It is the Customer's responsibility to inform the Broker of any modifications on the transported vehicle, that make the size and/or weight differ from manufacturer specifications and to avoid excessive weight fees.",
      },
      {
        label: "D",
        body: "It is the Customer's responsibility that the vehicle is released to the Carrier in a timely and/or agreed upon fashion. If there is a delay including but not limited to storage, auction, port, towing, mechanical, scheduling, and/or personal problems, the Customer may be responsible for a Cancellation Fee, and/or a Dry Run Fee of $200.",
      },
      {
        label: "E",
        body: "Once the contract is signed between the Broker and Customer, all future conversations by phone, email, or text are null and void. If any changes need to be made, an addendum to the contract is required.",
      },
      {
        label: "F",
        important: true,
        body: "THIS IS VERY IMPORTANT, PLEASE READ CAREFULLY: It is the Customer's responsibility to request the bill of lading at the pick-up and request a condition report. The carrier might not offer this service, and if it is not completed and/or there is a claim we are not responsible and shall not be held liable for any damages and/or losses. It is the Customer's responsibility to mark all damages and keep a copy of the report until the final delivery. The damage report is the most essential document to have and/or file for reimbursement from Carrier's insurance. This contract is subject to all terms and conditions of Carriers' bill of lading and liability exclusions therein. US Star Trucking LLC has no responsibility and/or liability for any damage to a vehicle(s) and/or contents of said vehicle(s) during transport or at any other time. The vehicle is insured by the Carrier's insurance policy.",
      },
      {
        label: "G",
        body: "The Broker has 5 business days from the first available date in order to find the Carrier. If customer wants to terminate the contract before the 5 business days from first available date expire, the Customer may be responsible for a Cancellation Fee of $200.",
      },
      {
        label: "H",
        body: "The Broker reserves the right of assigning a Carrier to the Customer's order without any prior notification or confirmation. The broker will however make an attempt to inform the Customer of any changes to the order as they occur.",
      },
      {
        label: "I",
        body: "The Broker reserves the right to opt-out of this contract at any time with or without notice if unable to locate a Carrier for the original price the Customer was quoted. Due to the ever-changing and shifting auto transportation landscape, Carrier availability and pricing are subject to change, if this happens Broker will make all possible efforts to locate a secondary option for Customer's consideration.",
      },
      {
        label: "J",
        body: "The price of transportation provided by the company is based on recent shipments which were made on similar routes. The price may change at the time of assigning a Carrier due to the Mechanical failure, inclement weather, carrier's schedule, or Acts of God, or other circumstances.",
      },
      {
        label: "K",
        body: "The Customer agrees that he/she will pay the price as quoted/revised at the time of assigning a carrier by US Star Trucking LLC for delivered vehicles and will not seek to chargeback/refund on the card.",
      },
      {
        label: "L",
        body: "The Customer agrees that he/she will not seek chargeback/refund on the card against the reservation amount after receiving the carrier details.",
      },
    ],
  },
  {
    heading: "Terms and Conditions",
    clauses: [
      {
        label: "1",
        body: "US Star Trucking LLC is a registered and bonded property broker (MC-206532). This agreement is between the customer, (hereinafter referred to as Customer), US Star Trucking LLC, (hereinafter referred to as Broker) and Carrier Company (hereinafter referred to as Carrier). Customer allows Broker to contract with a licensed and insured Carrier(s) to transport the vehicle(s) described in the shipping order. This agreement and any shipment hereunder is subject to all terms and conditions of the Broker. This agreement supersedes all prior written or oral representation of Broker and constitutes the entire agreement between Customer and US Star Trucking LLC and may not be changed except in writing and signed by an officer of US Star Trucking LLC.",
      },
      {
        label: "2",
        body: "The Carrier will pick up and deliver as close to your door as legally and as safely as possible. A mutually agreeable place to load or unload may be necessary because of low-hanging trees, low hanging wires, narrow streets, residential area restrictions, etc.",
      },
      {
        label: "3",
        body: "The Broker shall provide Customer with an estimated pick up and estimated delivery date. However, delays may occur prior to, and/or during transport due to weather, road conditions, carrier mechanical problems, etc. There are absolutely no guarantees regarding pick-up or delivery times and dates. Broker shall not be held responsible for loss or damages occasioned by delays of any kind or for any reason, car rental fees, or any accommodation fees. Broker shall not be held liable for the failure of mechanical or operating parts of your vehicle.",
      },
      {
        label: "4",
        body: "The Customer must prepare vehicle for transport. All loose parts, fragile accessories, low-hanging spoilers, etc. must be removed or secured. Shipper shall remove all non-permanent outside mounted luggage, bike racks, and other racks prior to shipment. Vehicles must be tendered to carriers in good running condition (unless otherwise noted). Any part of the vehicle that falls off during transport is the Customer's responsibility including damages caused by said part to any vehicle(s) and/or person involved.",
      },
      {
        label: "5",
        body: "The Customer must disarm any alarm system installed in the vehicle or provide proper instructions for this matter. In the event said alarm sounds and there are no keys or instructions to turn it off, the Carrier may silence the alarm by any means.",
      },
      {
        label: "6",
        body: "Luggage and personal property must be confined in trunk only, with no heavy articles, and not to exceed 100 lbs. Broker or Carrier is not liable for personal items left in the vehicle, nor for damage caused to vehicle from excessive or improper loading of personal items. No personal property shall be transported in the customer's vehicle(s) that includes but is not limited to Explosives, Guns, Ammunition, Flammable Products, Narcotics, Negotiable and Legal Papers, Alcoholic Beverages, Jewelry, Furs, Money, Live Pets, Live Plants, or any unlawful contraband. The customer agrees that US Star Trucking LLC may confiscate or dispose of said items with no remuneration. Broker or Driver will not be held responsible for the delivery of personal property. If the Customer wishes to put items in the vehicle he does so at his own risk.",
      },
      {
        label: "7",
        body: "International orders; the car must be empty except for factory-installed equipment. Indicate serial #, and give the car's approximate value in U.S. dollars. The shipper is responsible for the proper customs paperwork (ask the assigned carrier for help with these documents).",
      },
      {
        label: "8",
        body: "If the vehicle is inoperable or oversize (dual or oversize wheels, extra-large, racks, lifted, limo, etc.), the inoperable fee is $200.00. Customers must inquire as to extra charges for lifted or modified vehicles. If the Broker is not advised of inoperable or oversized/modified vehicles prior to pick-up, there can be additional charges. If the assigned carrier is unable to load due to size issues, a no-load fee up to $1,000.00 can be charged at the broker's discretion.",
      },
      {
        label: "9",
        body: "Once a carrier has been assigned to pick up and transport the Customer's vehicle Broker will contact the customer to confirm the schedule via phone or email (the email address provided in your car shipping order). After confirmation, Carriers' contact info will be sent via email.",
      },
      {
        label: "10",
        body: "If the Customer decides to cancel the order after a Carrier has been assigned (see Paragraph 9 of how we notify Customer) the reservation will NOT be refunded. Broker has the right to cancel any order at any time for any reason.",
      },
      {
        label: "11",
        body: "The Customer understands that ANY Exotic, Restored, Classic, Antique, Vintage, Specialty, Custom, or such related vehicle may be excluded under the carrier's standard cargo insurance policy. It is the Customer's FULL responsibility to obtain their own \"binder\" policy for such vehicles during transport to ensure proper coverage. Broker does not offer ANY Cargo or Liability coverage.",
      },
      {
        label: "12",
        body: "On pick up, the Customer and Carrier will carefully inspect the vehicle for pre-existing damage (exterior only) by completing a vehicle inspection report. The Carrier and Customer will both acknowledge the condition of the vehicle and the Customer will sign and receive a copy of the bill of lading. At the time of delivery, the Customer and Carrier will carefully inspect the vehicle for transportation damages. The Carrier and Customer will both acknowledge the condition of the vehicle and the Customer will sign and receive a final copy of the bill of lading. From the time of pick up, until delivery, the Customer agrees to carry their own full coverage insurance on vehicle from the time of pickup until delivery, in the event, the carrier's insurance denies coverage for loss or damage, the customer shall file a claim with their own insurance and not hold Broker liable.",
      },
      {
        label: "13",
        body: "In any event, the Broker will not be responsible for ANY damage or loss to you, involved parties, or the vehicle during transport. The Carrier actually transporting the vehicle shall be liable for any and all damage arising from the transport. Shipper agrees to file all claims with the carrier as identified on the bill of lading/vehicle inspection report and bring any legal action for damage against carrier ONLY. Shipper agrees to release and hold Broker harmless of ANY such loss or claims. Limitations of Broker liability in connection with the vehicle is limited to the lesser of your actual damage or actual cash value of the vehicle or $50,000. All damage must be noted in the proper place on the Carrier's Bill of lading and signed by the Customer, regardless of whether or time of day. Signing the Carrier's bill of lading or inspection report without notation of any damage verifies that the Customer has received vehicle(s) in satisfactory condition. All claims must be submitted in writing to Broker and/or Carrier within 24 hours of delivery. The broker will share the carrier insurance policy upon request. Department of Transportation regulations requires that all claims are filed in writing and all tariffs are paid in full before a claim can be processed. If for any reason the Carrier's insurance denies coverage, the Customer will file a claim for damages or loss with their own insurance and not hold the Broker liable.",
      },
      {
        label: "14",
        body: "The Carrier accepts FULL responsibility for the vehicle after pre-inspection is done and is signed by the Customer. Carrier responsibility will end when the vehicle is delivered and the Customer signs the final inspection.",
      },
      {
        label: "15",
        body: "The Broker will not be responsible for damage caused by acts of God, hail or storm damage, or damage resulting from worn/broken parts of a vehicle/item.",
      },
      {
        label: "16",
        body: "The Customer shall, in their absence, designate a person to act as their agent at the point of pick up and/or delivery, if for any reason they are unavailable.",
      },
      {
        label: "17",
        body: "The Customer agrees to pay the Broker the specified deposit/reservation fee as agreed per contract. The customer agreed to pay Carrier the specified amount minus the deposit/reservation fee which has been paid in advance to the Broker. All payments for Carrier must be in the form of Cash, Cashier's check, or Money order. Personal checks or credit cards will NOT be accepted for the remaining balance — unless agreed by Carrier and put in writing by the Broker. The Customer agrees that if the payment cannot be made by these methods, the vehicle/item will be stored at the Customer's expense until the Customer pays in full for all transport charges, storage charges, and other charges if needed. Should the Customer be unable to accept delivery for any reason, the vehicle/item will be placed in storage. Any and all storage and delivery charges will be the responsibility of the Customer.",
      },
      {
        label: "18",
        body: "In the event the Customer selects \"Cash on Delivery\" (COD) as the payment method but subsequently pays the Carrier using a check, certified check, or money order, and the Carrier accepts such payment but is unable to process it due to, including but not limited to, insufficient funds, canceled check, a reversed check, or identity verification issues, the Broker retains the right to charge the remaining balance owed to the payment card provided by the Customer for the Broker fee or deposit. By agreeing to these terms, the Customer expressly waives the right to initiate a chargeback, request a refund, or dispute the transaction for the remaining balance charged under this provision.",
      },
      {
        label: "19",
        body: "The Broker may submit Customer's data to competent authorities either upon their request or if fraud or any suspicious activity is determined on the Website.",
      },
      {
        label: "20",
        body: "We want all of our customers to feel safe using our services. If there are any kind of damage or any issues with your vehicle during the delivery process, we want you to feel safe because each truck and driver is supposed to have a $100,000 insurance policy. Broker is not responsible for any damages and all claims are to be filed with the carrier.",
      },
      {
        label: "21",
        body: "Governing Law & Jurisdiction: This Agreement shall be construed and interpreted in accordance with the laws of the State of Tennessee. The Parties agree that any dispute regarding the terms or conditions hereunder shall be held in Tennessee, and the Parties consent to personal jurisdiction and venue before any court of competent subject matter jurisdiction, whether federal or state, in the county where US Star Trucking LLC is headquartered. The prevailing party in any litigation, arbitration, or mediation relating to this agreement shall be entitled to recover its reasonable attorney's fees and costs from the other party, including appeals.",
      },
    ],
  },
];
