import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import AlertMessage from "../components/common/AlertMessage";
import { SUBJECT_GROUPS, SUBJECTS } from "../lib/clusterEngine";
import { ChevronDown } from "lucide-react";

type SubjectCode = keyof typeof SUBJECTS;

const emptyGrades = () => Object.fromEntries(Object.keys(SUBJECTS).map((code) => [code, ""]));

const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow";
const toggleButtonClass =
  "mt-3 inline-flex w-full items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100";
const selectClass =
  " w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-slate-900 shadow-sm focus:border-slate-500 focus:ring-slate-500";

type CalculatorPageProps = {
  onContinue: (grades: Record<string, string>) => void;
  gradeOptions: string[];
};

export default function CalculatorPage({ onContinue, gradeOptions }: CalculatorPageProps) {
  const navigate = useNavigate();
  const [grades, setGrades] = useState<Record<string, string>>(emptyGrades());
  const [openDropdownByGroup, setOpenDropdownByGroup] = useState<Record<string, boolean>>(
    Object.fromEntries(SUBJECT_GROUPS.map((group, index) => [group.title, index === 0])),
  );
  const [formError, setFormError] = useState("");

  const updateGrade = (subjectCode: string, grade: string) => {
    setGrades((current) => ({ ...current, [subjectCode]: grade }));
  };

  const getSubjectLabel = (subjectCode: string) => SUBJECTS[subjectCode as SubjectCode] || subjectCode;

  const getGradedSubjects = () =>
    Object.entries(grades)
      .filter(([, grade]) => grade && grade !== "")
      .map(([code]) => code);

  const toggleDropdown = (groupTitle: string) => {
    setOpenDropdownByGroup((current) => {
      const next = Object.fromEntries(Object.keys(current).map((key) => [key, false]));
      next[groupTitle] = !current[groupTitle];
      return next;
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    const gradedSubjects = getGradedSubjects();
    if (gradedSubjects.length < 7) {
      setFormError("Select grades for at least 7 subjects across all groups to compute cluster points.");
      return;
    }

    const payload = emptyGrades();
    gradedSubjects.forEach((subjectCode) => {
      payload[subjectCode] = grades[subjectCode];
    });

    onContinue(payload);
    navigate("/payment");
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Cluster Points Calculator</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter your grades by subject group, then continue to payment.
      </p>
      

      <form onSubmit={submit} className="mt-6 space-y-6">
        <AlertMessage tone="danger" message={formError} />

        <div className="grid gap-5 xl:grid-cols-2">
          {SUBJECT_GROUPS.map((group) => (
            <article key={group.title} className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{group.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {group.required
                      ? "Core group. Enter grades for all listed subjects."
                      : "Optional group. Fill available subjects."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => toggleDropdown(group.title)}
                className={toggleButtonClass}
              >
                <span>{openDropdownByGroup[group.title] ? "Hide grade fields" : "Show grade fields"}</span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-500 transition-transform ${
                    openDropdownByGroup[group.title] ? "rotate-180" : "rotate-0"
                  }`}
                />
              </button>

              {openDropdownByGroup[group.title] ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {group.subjects.map((subjectCode) => (
                    <div key={subjectCode}>
                      <label
                        htmlFor={`${group.title}-${subjectCode}`}
                        className="mb-1 block text-sm font-medium text-slate-700"
                      >
                        {getSubjectLabel(subjectCode)}
                        {group.required ? <span className="text-rose-600"> *</span> : null}
                      </label>
                      <select
                        id={`${group.title}-${subjectCode}`}
                        value={grades[subjectCode]}
                        onChange={(event) => updateGrade(subjectCode, event.target.value)}
                        required={group.required}
                        className={selectClass}
                      >
                        <option value="">Select grade</option>
                        {gradeOptions.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:from-slate-800 hover:to-slate-700"
        >
          Calculate Cluster Points
        </button>
      </form>
    </section>
  );
}
