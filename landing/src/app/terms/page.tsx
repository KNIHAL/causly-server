export default function TermsOfService() {
    return (
        <main className="min-h-screen bg-[#030b0d] px-5 py-20 text-white sm:px-8 lg:px-12">
            <article className="mx-auto max-w-4xl">
                <p className="text-xs font-medium tracking-[0.25em] text-[#35d6c5]">
                    CAUSLY
                </p>

                <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                    Terms of Service
                </h1>

                <p className="mt-4 text-sm text-white/40">
                    Last updated: September 6, 2026
                </p>

                <div className="mt-12 space-y-10 text-[15px] leading-7 text-white/60">
                    <Section title="1. Acceptance of Terms">
                        <p>
                            These Terms of Service govern your access to and use of Causly
                            websites, software, products, and services.
                        </p>

                        <p className="mt-4">
                            By accessing or using Causly, you agree to be bound by these
                            Terms. If you do not agree with these Terms, you should not use
                            the services.
                        </p>
                    </Section>

                    <Section title="2. Causly Services">
                        <p>
                            Causly provides infrastructure and execution capabilities that
                            allow AI agents and users to interact with software environments,
                            code, files, tools, and other resources.
                        </p>

                        <p className="mt-4">
                            Causly may provide both open-source software intended to run in
                            user-controlled environments and hosted services operated by
                            Causly.
                        </p>
                    </Section>

                    <Section title="3. Your Responsibilities">
                        <p>You are responsible for:</p>

                        <ul className="mt-4 list-disc space-y-2 pl-5">
                            <li>
                                The instructions, code, files, and resources you provide or
                                make accessible to an AI agent.
                            </li>
                            <li>
                                Ensuring that your use of Causly complies with applicable laws.
                            </li>
                            <li>
                                Maintaining appropriate permissions for systems and resources
                                connected to Causly.
                            </li>
                            <li>
                                Protecting credentials, tokens, and other authentication
                                information under your control.
                            </li>
                            <li>
                                Reviewing and validating actions performed by AI agents where
                                appropriate.
                            </li>
                        </ul>
                    </Section>

                    <Section title="4. AI-Generated and Agent-Performed Actions">
                        <p>
                            AI agents can produce unexpected outputs or perform unintended
                            actions. Causly provides execution infrastructure and does not
                            guarantee that an AI agent will always behave as intended.
                        </p>

                        <p className="mt-4">
                            You are responsible for determining which agents, instructions,
                            tools, permissions, and environments are appropriate for your
                            use case.
                        </p>
                    </Section>

                    <Section title="5. Local Software">
                        <p>
                            Causly OSS may be installed and operated in environments
                            controlled by you. You are responsible for your local machine,
                            operating system, network, credentials, connected services, and
                            any actions performed within that environment.
                        </p>
                    </Section>

                    <Section title="6. Hosted Services">
                        <p>
                            Causly Hosted provides managed execution infrastructure subject
                            to the applicable service configuration, usage limits, and
                            policies.
                        </p>

                        <p className="mt-4">
                            We may modify, suspend, or discontinue parts of the hosted
                            service when reasonably necessary for maintenance, security,
                            product development, or other operational reasons.
                        </p>
                    </Section>

                    <Section title="7. Prohibited Use">
                        <p>
                            You may not use Causly to violate applicable laws, obtain
                            unauthorized access to systems or data, distribute malicious
                            software, interfere with other users or infrastructure, or
                            otherwise abuse the service.
                        </p>

                        <p className="mt-4">
                            We reserve the right to restrict or suspend access where we
                            reasonably believe the service is being abused or used in a way
                            that creates security, legal, or operational risks.
                        </p>
                    </Section>

                    <Section title="8. Intellectual Property">
                        <p>
                            Causly and its associated software, branding, documentation,
                            designs, and other materials remain the property of Causly or
                            their respective licensors, except where explicitly provided
                            under an applicable open-source license.
                        </p>
                    </Section>

                    <Section title="9. Your Content">
                        <p>
                            You retain ownership of content, code, files, and other materials
                            that you provide to Causly, subject to the rights necessary for
                            us to operate the services you request.
                        </p>
                    </Section>

                    <Section title="10. Third-Party Services">
                        <p>
                            Causly may integrate with third-party services, AI models,
                            infrastructure providers, developer tools, and other platforms.
                        </p>

                        <p className="mt-4">
                            Your use of those services may be governed by separate terms and
                            policies established by the respective providers.
                        </p>
                    </Section>

                    <Section title="11. Availability">
                        <p>
                            We aim to provide reliable services, but we do not guarantee that
                            Causly will always be available, uninterrupted, error-free, or
                            suitable for every use case.
                        </p>
                    </Section>

                    <Section title="12. Disclaimer">
                        <p>
                            Causly is provided on an “as is” and “as available” basis to the
                            maximum extent permitted by applicable law. We disclaim
                            warranties that are not expressly stated in these Terms.
                        </p>
                    </Section>

                    <Section title="13. Limitation of Liability">
                        <p>
                            To the maximum extent permitted by applicable law, Causly and its
                            operators will not be liable for indirect, incidental, special,
                            consequential, or similar damages arising from your use of the
                            services.
                        </p>
                    </Section>

                    <Section title="14. Changes to These Terms">
                        <p>
                            We may update these Terms from time to time. Updated Terms will
                            be published on this page with a revised effective date.
                            Continued use of the services after the updated Terms become
                            effective constitutes acceptance of the changes.
                        </p>
                    </Section>

                    <Section title="15. Contact">
                        <p>
                            Questions regarding these Terms can be sent to:
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