export function slipTypeForCount(count) {
    const legCount = Number(count);

    if (legCount === 1) return 'Single';
    if (legCount === 2) return 'Double';
    if (legCount === 3) return 'Treble';

    return `${legCount}-Fold Accumulator`;
}
