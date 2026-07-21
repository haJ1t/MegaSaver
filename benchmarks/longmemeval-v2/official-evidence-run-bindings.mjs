import { isDeepStrictEqual } from "node:util";

function fail(message) {
  throw new Error(message);
}

function flagValue(arguments_, flag) {
  const indexes = arguments_.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1 || indexes[0] === arguments_.length - 1) {
    fail(`Executed run argument differs: ${flag}`);
  }
  return arguments_[indexes[0] + 1];
}

function finiteNonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${label} is invalid.`);
  }
}

function questionImagePresent(question) {
  return typeof question.question === "object" && question.question !== null;
}

function validateTelemetry(input, questionById, manifestQuestionById, projectionCountById) {
  const telemetryById = new Map(input.telemetry.map((row) => [row.questionId, row]));
  const fingerprint = input.canonicalSha256(input.memoryParams.model);
  const statuses = new Set(["not_requested", "used", "used_partial_index", "degraded", "rejected"]);
  for (const output of input.perQuestion) {
    const row = telemetryById.get(output.question_id);
    const question = questionById.get(output.question_id);
    const manifestQuestion = manifestQuestionById.get(output.question_id);
    if (
      !row ||
      !question ||
      !manifestQuestion ||
      !isDeepStrictEqual(row, output.memory_post_query_metadata)
    ) {
      fail("Telemetry does not exactly match official per-question metadata.");
    }
    if (
      row.profile !== input.memoryParams.profile ||
      !statuses.has(row.semanticStatus) ||
      row.modelFingerprint !== fingerprint ||
      row.questionType !== question.question_type ||
      row.questionType !== manifestQuestion.questionType ||
      row.imagePresent !== questionImagePresent(question) ||
      row.imagePresent !== manifestQuestion.imagePresent ||
      row.imageUsed !== false ||
      (Object.hasOwn(row, "rejectionReason") && typeof row.rejectionReason !== "string") ||
      (Object.hasOwn(row, "observedAt") &&
        (typeof row.observedAt !== "string" || Number.isNaN(Date.parse(row.observedAt)))) ||
      (Object.hasOwn(row, "auditId") &&
        (typeof row.auditId !== "string" || !/^[0-9a-f]{32}$/u.test(row.auditId)))
    ) {
      fail("Telemetry configuration or question correlation differs.");
    }
    const available = manifestQuestion.trajectories.reduce(
      (sum, entry) => sum + (projectionCountById.get(entry.id) ?? 0),
      0,
    );
    if (
      !Number.isInteger(row.candidateCount) ||
      !Number.isInteger(row.selectionCount) ||
      row.candidateCount < 0 ||
      row.selectionCount < 0 ||
      row.selectionCount > row.candidateCount ||
      row.candidateCount > available ||
      !Array.isArray(output.memory_context) ||
      row.selectionCount !== output.memory_context.length
    ) {
      fail("Telemetry candidate counts differ from the manifest chain.");
    }
    finiteNonnegative(row.latencyMs, "telemetry latencyMs");
    const privateTexts = [
      typeof question.question === "string" ? question.question : question.question?.text,
      question.answer,
    ].filter((value) => typeof value === "string" && value.length > 0);
    const publicIdentity = new Set([
      row.profile,
      row.semanticStatus,
      row.modelFingerprint,
      row.questionId,
      row.questionType,
    ]);
    for (const value of Object.values(row)) {
      if (
        typeof value === "string" &&
        !publicIdentity.has(value) &&
        privateTexts.some((text) => value.includes(text))
      ) {
        fail("Telemetry contains raw question content.");
      }
    }
  }
}

export function officialCombinedTiming(samples) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    avg_seconds: total / samples.length,
    max_seconds: Math.max(...samples),
    total_seconds: total,
  };
}

export function verifyRunBindings(input) {
  const expectedPaths = {
    "--questions-path": input.paths.questions,
    "--haystack-path": input.paths.haystack,
    "--trajectories-path": input.paths.trajectories,
    "--memory-config-path": input.paths.memoryConfig,
    "--output-dir": input.outputDirectory,
  };
  const runArgKeys = {
    "--questions-path": "questions_path",
    "--haystack-path": "haystack_path",
    "--trajectories-path": "trajectories_path",
    "--memory-config-path": "memory_config_path",
    "--output-dir": "output_dir",
  };
  for (const [flag, path] of Object.entries(expectedPaths)) {
    if (flagValue(input.arguments, flag) !== path || input.runArgs[runArgKeys[flag]] !== path) {
      fail(`Recorded input path differs: ${flag}`);
    }
  }
  if (
    flagValue(input.arguments, "--domain") !== input.domain ||
    flagValue(input.arguments, "--model") !== input.runArgs.model ||
    flagValue(input.arguments, "--evaluator-model") !== input.runArgs.evaluator_model ||
    input.runArgs.domain !== input.domain ||
    input.runArgs.model !== input.configuration.reader.model ||
    input.runArgs.evaluator_model !== input.configuration.judge.model
  ) {
    fail("Executed reader or evaluator configuration differs.");
  }
  const questionById = new Map(input.questions.map((row) => [row.id, row]));
  const manifestQuestionById = new Map(
    input.manifest.questions.map((row) => [row.questionId, row]),
  );
  const trajectoryById = new Map(input.trajectories.map((row) => [row.id, row]));
  const projectionCountById = new Map(
    input.manifest.trajectories.map((row) => [row.id, row.projections.length]),
  );
  if (
    questionById.size !== input.questions.length ||
    trajectoryById.size !== input.trajectories.length ||
    input.questions.some((question) => {
      const manifestQuestion = manifestQuestionById.get(question.id);
      return (
        !manifestQuestion ||
        question.domain !== input.domain ||
        question.question_type !== manifestQuestion.questionType ||
        questionImagePresent(question) !== manifestQuestion.imagePresent ||
        !isDeepStrictEqual(
          input.haystack[question.id],
          manifestQuestion.trajectories.map((entry) => entry.id),
        )
      );
    })
  ) {
    fail("Recorded questions or haystack differ from the manifest.");
  }
  for (const manifestTrajectory of input.manifest.trajectories) {
    const trajectory = trajectoryById.get(manifestTrajectory.id);
    if (!trajectory || input.canonicalSha256(trajectory) !== manifestTrajectory.fullObjectDigest) {
      fail("Recorded trajectory bytes differ from the manifest.");
    }
  }
  const outputById = new Map(input.perQuestion.map((row) => [row.question_id, row]));
  for (const question of input.questions) {
    const output = outputById.get(question.id);
    if (
      !output ||
      output.question_type !== question.question_type ||
      output.answer_gold !== question.answer ||
      output.question_image !== (questionImagePresent(question) ? question.question.image : null)
    ) {
      fail("Official answer or evaluator input differs from the executed question.");
    }
  }
  validateTelemetry(input, questionById, manifestQuestionById, projectionCountById);
}
