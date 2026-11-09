import type { ReactNode } from 'react';
import { Link } from '../router';
import { PRICE_FIVE, PRICE_ONE, SUPPORT_EMAIL } from '../content';

const UPDATED = 'November 9, 2026';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal wrap narrow">
      <h1>{title}</h1>
      <p className="updated">Last updated {UPDATED}</p>
      {children}
    </main>
  );
}

const Mail = () => <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

export function Terms() {
  return (
    <LegalPage title="Terms">
      <p>
        These terms cover buying and using Driftsky. Buying gets you a lifetime license key for Driftsky on your own computers, Mac or PC, including every update we
        release.
      </p>
      <h2>Payment</h2>
      <p>
        A key for 1 computer is ${PRICE_ONE} USD and a key for up to 5 computers is ${PRICE_FIVE} USD, paid once through Stripe. There is no subscription. Prices may be
        lower in some countries: Stripe sets the local price from where you’re connecting, and the price shown at checkout is what you pay.
      </p>
      <h2>Checkout offer</h2>
      <p>
        If you leave checkout without paying and agreed there to hear about offers, we may email you once with 20% off the plan you chose. The code works for 48 hours
        from that email, can’t be combined with other codes, and we may change or end the offer at any time.
      </p>
      <h2>Your key</h2>
      <p>
        We email your license key as soon as you’ve paid. It unlocks Driftsky on 1 computer or up to 5, depending on what you bought, and Macs and PCs count the same. To
        move it, remove it in the app on the old computer and paste it on the new one. Because the key is delivered straight away, you ask us to deliver it immediately
        and agree that the right to cancel a digital purchase ends once it’s delivered, apart from our <Link href="/refunds">refund policy</Link>.
      </p>
      <h2>Refunds</h2>
      <p>
        We refund you if Driftsky doesn’t work on your computer and you tell us within 3 days of buying. A change of mind isn’t covered. Details are in the{' '}
        <Link href="/refunds">refund policy</Link>.
      </p>
      <h2>Fair use</h2>
      <p>Please don’t share your key beyond the computers it covers, and don’t resell it. The wallpapers are for your own desktop.</p>
      <h2>Ending a key</h2>
      <p>We can turn off a key that has been refunded, charged back, shared publicly or resold.</p>
      <h2>No warranty</h2>
      <p>Driftsky is provided as is. Our liability is limited to what you paid for it.</p>
      <h2>Changes</h2>
      <p>
        We may update these terms; the date above shows the latest version. Questions? Write to <Mail />.
      </p>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy">
      <p>We keep as little about you as we can. Here is everything.</p>
      <h2>The app</h2>
      <p>
        The effects and wallpapers run entirely on your computer. To let weather land on your windows, Driftsky reads where your windows are on screen, never what’s in
        them, and that information never leaves your computer. Your settings (effect, wallpaper, intensity) are stored on your computer too.
      </p>
      <h2>What the app sends us</h2>
      <p>
        Driftsky contacts our server for two things only. Every few hours it asks whether a newer version is out, and downloads it from our download server when there is.
        When you add, check or remove your key, it sends the key and a code for your computer. That code is a one-way scramble of your computer’s hardware ID, which we
        scramble again before storing, so it can’t be turned back into the ID. The app sends no usage analytics.
      </p>
      <p>Like any request on the internet, these include your IP address. We don’t store it beyond our server’s short-lived logs.</p>
      <h2>Your license</h2>
      <p>
        When you buy, we store your email, your key, how many computers it covers, and the Stripe payment reference, so we can resend your key and handle refunds. We
        send the key by email through our email provider (Resend). For each computer using the key, we store its scrambled code, its name if the app provides one,
        when it was added and when it last checked in. Remove the key in the app and that computer’s record is deleted.
      </p>
      <p>
        Upgrading from 1 to 5 computers in the app sends your key and computer code to our server, which checks them and passes your key reference and email to Stripe
        with the payment.
      </p>
      <h2>Payments</h2>
      <p>
        Stripe handles checkout. We never see or store your card details. Stripe’s own privacy policy applies to the payment itself.
      </p>
      <h2>This website</h2>
      <p>
        If you click OK on the cookie banner, a cookie lets us see which pages and buttons get used, through our analytics provider. Click No thanks and nothing is set.
        You can change your mind any time with Cookie settings at the bottom of every page.
      </p>
      <h2>Your rights</h2>
      <p>
        Want a copy of what we hold about you, or want it deleted? Write to <Mail /> from the email you bought with. Deleting your license data turns off your key.
      </p>
    </LegalPage>
  );
}

export function Refunds() {
  return (
    <LegalPage title="Refund policy">
      <p>We want Driftsky to work for you. If it doesn’t, here’s how refunds work.</p>
      <h2>When we refund</h2>
      <p>
        If Driftsky doesn’t run properly on your computer and you tell us within 3 days of buying, we refund you in full. Please tell us what you see and which system
        you’re on (for example macOS 15 on a MacBook Air, or Windows 11) so we can try to fix it first.
      </p>
      <h2>When we don’t</h2>
      <p>Changing your mind, buying by mistake when the app works, or asking after 3 days aren’t covered.</p>
      <h2>What happens to the key</h2>
      <p>A refunded key is turned off on every computer it’s on.</p>
      <h2>How to ask</h2>
      <p>
        Write to <Mail /> from the email address you paid with. Refunds go back to the original payment method and usually show up within 5–10 business days.
      </p>
    </LegalPage>
  );
}
