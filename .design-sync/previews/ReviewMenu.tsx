import { ReviewMenu } from 'tixhub';

const noop = () => {};

// One export only, deliberately. The menu owns its open state internally and
// starts closed, so every item set renders the same trigger — separate cells
// for "own comment" vs "other comment" looked identical and taught nothing.
// Composed on a comment header row, which is the only context it appears in;
// alone on a card it read as blank.
export const OnAComment = () => (
  <div className="flex w-80 items-start justify-between gap-3 rounded-lg border border-beige-kem/15 bg-xanh-pho p-3">
    <div>
      <p className="text-sm font-semibold text-beige-kem">Ngọc Lan</p>
      <p className="mt-0.5 text-xs text-beige-kem/70">
        Ghế đẹp, âm thanh tốt. Sẽ quay lại lần sau.
      </p>
    </div>
    <ReviewMenu
      items={[
        { label: 'Chỉnh sửa', onSelect: noop },
        { label: 'Xoá bình luận', onSelect: noop, danger: true },
      ]}
    />
  </div>
);
