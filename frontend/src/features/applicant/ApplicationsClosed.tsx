import { Link } from '@tanstack/react-router';
import { Prose } from '../../components/Layout';

/**
 * What an applicant with an unsubmitted draft sees while APPLICATIONS_OPEN is
 * false. Their answers are kept; they just cannot be edited or submitted.
 */
export function ApplicationsClosed() {
  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Applications closed</p>
      <h1 className="mb-4">We&rsquo;re not accepting applications right now.</h1>
      <p className="text-lg text-ink/90 mb-6">
        Our first term is underway, and applications for it have closed. We
        expect to open another round of applications in the future.
      </p>
      <p className="text-muted mb-10">
        If you started an application, we&rsquo;ve kept what you wrote.
        Questions? Write to us at{' '}
        <a href="mailto:ross@rossprogram.org" className="font-mono">
          ross@rossprogram.org
        </a>
        .
      </p>
      <Link to="/" className="btn btn-ghost no-underline">
        ← Back to the program page
      </Link>
    </Prose>
  );
}
