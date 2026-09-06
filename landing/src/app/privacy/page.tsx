export default function PrivacyPolicy() {
    return (
        <main className="min-h-screen bg-[#030b0d] px-5 py-20 text-white sm:px-8 lg:px-12">
            <article className="mx-auto max-w-4xl">
                <p className="text-xs font-medium tracking-[0.25em] text-[#35d6c5]">
                    CAUSLY
                </p>

                <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                    Privacy Policy
                </h1>

                <p className="mt-4 text-sm text-white/40">
                    Last updated: September 6, 2026
                </p>

                <div className="mt-12 space-y-10 text-[15px] leading-7 text-white/60">
                    <Section title="1. Introduction">
                        <p>
                            This Privacy Policy explains how Causly collects, uses, stores,
                            and protects information when you visit our website, use Causly
                            Agent Environment, interact with our services, or contact us.
                        </p>
                        <p className="mt-4">
                            By using Causly, you acknowledge the practices described in this
                            policy.
                        </p>
                    </Section>

                    <Section title="2. Information We Collect">
                        <p>
                            We may collect information that you voluntarily provide to us,
                            such as your name, email address, company information, and other
                            information submitted through forms, waitlists, or other
                            interactions.
                        </p>

                        <p className="mt-4">
                            We may also automatically collect limited technical information,
                            including browser type, device information, approximate
                            location, pages visited, and basic usage information.
                        </p>
                    </Section>

                    <Section title="3. Information You Provide to Causly">
                        <p>
                            When using Causly services, you may provide or make accessible
                            code, files, repositories, credentials, configurations, or other
                            information required for an agent to perform work.
                        </p>

                        <p className="mt-4">
                            The nature of information accessible to Causly depends on the
                            product, configuration, and permissions you choose to provide.
                            You are responsible for ensuring that you have the right to
                            provide such information and permissions.
                        </p>
                    </Section>

                    <Section title="4. How We Use Information">
                        <p>We may use collected information to:</p>

                        <ul className="mt-4 list-disc space-y-2 pl-5">
                            <li>Provide and operate Causly services.</li>
                            <li>Respond to questions and support requests.</li>
                            <li>Manage waitlists and product communications.</li>
                            <li>Improve reliability, security, and user experience.</li>
                            <li>Understand product usage and develop new features.</li>
                            <li>Detect, prevent, and investigate abuse or security issues.</li>
                            <li>Comply with applicable legal obligations.</li>
                        </ul>
                    </Section>

                    <Section title="5. AI Agents and Third-Party Services">
                        <p>
                            Causly may interact with AI clients, models, developer tools,
                            infrastructure providers, and other third-party services
                            depending on how you configure and use the product.
                        </p>

                        <p className="mt-4">
                            Information processed by those services may be subject to their
                            own terms and privacy policies. You should review the policies
                            of any third-party service you choose to connect to Causly.
                        </p>
                    </Section>

                    <Section title="6. Local and Hosted Environments">
                        <p>
                            Causly OSS is designed to run in your own environment. Data and
                            resources accessed by an agent through a local installation may
                            remain within your environment depending on your configuration
                            and connected services.
                        </p>

                        <p className="mt-4">
                            Causly Hosted provides managed execution infrastructure. Data
                            processed through hosted services may be stored or processed by
                            Causly and its infrastructure providers as necessary to provide
                            the service.
                        </p>
                    </Section>

                    <Section title="7. Data Security">
                        <p>
                            We take reasonable technical and organizational measures to
                            protect information against unauthorized access, loss, misuse,
                            alteration, or disclosure.
                        </p>

                        <p className="mt-4">
                            However, no internet service, software, or method of electronic
                            storage can be guaranteed to be completely secure.
                        </p>
                    </Section>

                    <Section title="8. Data Retention">
                        <p>
                            We retain information only for as long as reasonably necessary
                            for the purposes described in this policy, including providing
                            services, maintaining security, resolving disputes, and meeting
                            legal obligations.
                        </p>
                    </Section>

                    <Section title="9. Your Choices">
                        <p>
                            Depending on the information and service involved, you may
                            request access to, correction of, or deletion of your personal
                            information.
                        </p>

                        <p className="mt-4">
                            You may also unsubscribe from non-essential communications by
                            following the instructions included in those communications.
                        </p>
                    </Section>

                    <Section title="10. Children's Privacy">
                        <p>
                            Causly is not intended for children under the age of 13. We do
                            not knowingly collect personal information from children under
                            13.
                        </p>
                    </Section>

                    <Section title="11. Changes to This Policy">
                        <p>
                            We may update this Privacy Policy from time to time. When we
                            make changes, we will update the date shown at the top of this
                            page. Continued use of Causly after changes become effective
                            constitutes acceptance of the updated policy.
                        </p>
                    </Section>

                    <Section title="12. Contact">
                        <p>
                            If you have questions about this Privacy Policy or how Causly
                            handles information, contact us at:
                        </p>

                        <p className="mt-4 text-[#35d6c5]">
                            <a href="mailto:nihal@causly.in">nihal@causly.in</a>
                        </p>
                    </Section>
                </div>
            </article>
        </main>
    );
}

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section>
            <h2 className="text-xl font-semibold tracking-tight text-white">
                {title}
            </h2>

            <div className="mt-4">{children}</div>
        </section>
    );
}