import React from 'react';
import styles from './AdjustmentSlider.module.css';

interface AdjustmentSliderProps {
    label: string;
    icon: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue: number;
    unit?: string;
    onChange: (value: number) => void;
    onReset: () => void;
}

const AdjustmentSlider: React.FC<AdjustmentSliderProps> = ({
    label,
    icon,
    value,
    min,
    max,
    step = 1,
    defaultValue,
    unit = '%',
    onChange,
    onReset,
}) => {
    const percentage = ((value - min) / (max - min)) * 100;
    const isDefault = value === defaultValue;

    return (
        <div className={styles.wrapper}>
            <div className={styles.header}>
                <div className={styles.labelRow}>
                    <span className={styles.icon}>{icon}</span>
                    <span className={styles.label}>{label}</span>
                </div>
                <div className={styles.valueRow}>
                    <span className={`${styles.value} ${!isDefault ? styles.valueActive : ''}`}>
                        {value}{unit}
                    </span>
                    {!isDefault && (
                        <button
                            className={styles.resetBtn}
                            onClick={onReset}
                            title={`Reset ${label}`}
                            aria-label={`Reset ${label}`}
                        >
                            ↺
                        </button>
                    )}
                </div>
            </div>

            <div className={styles.sliderWrap}>
                {/* Track fill indicator */}
                <div
                    className={styles.track}
                    style={{ '--fill': `${percentage}%` } as React.CSSProperties}
                />
                <input
                    type="range"
                    className={styles.slider}
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    aria-label={label}
                />
            </div>

            <div className={styles.ticks}>
                <span>{min}{unit}</span>
                <span>{defaultValue}{unit}</span>
                <span>{max}{unit}</span>
            </div>
        </div>
    );
};

export default AdjustmentSlider;
