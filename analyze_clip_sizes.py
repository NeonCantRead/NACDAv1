import os
from pathlib import Path
from moviepy import VideoFileClip
import statistics

def analyze_clips_advanced(directory):
    """Comprehensive analysis of MP4 files with detailed statistics and correlations"""
    directory = Path(directory)
    
    if not directory.exists():
        print(f"Directory not found: {directory}")
        return
    
    mp4_files = list(directory.glob("*.mp4"))
    
    if not mp4_files:
        print(f"No MP4 files found in {directory}")
        return
    
    print(f"Found {len(mp4_files)} MP4 files")
    print(f"Performing comprehensive analysis...\n")
    
    # Data structures for analysis
    clips_data = []
    file_count = 0
    errors = []
    
    for video_file in mp4_files:
        try:
            # Get file size
            file_size = video_file.stat().st_size  # in bytes
            
            # Get video metadata using moviepy
            clip = VideoFileClip(str(video_file))
            duration = clip.duration  # in seconds
            fps = clip.fps
            resolution = clip.size  # (width, height)
            has_audio = clip.audio is not None
            
            # Calculate derived metrics
            bitrate = (file_size * 8) / duration if duration > 0 else 0  # bits per second
            bytes_per_second = file_size / duration if duration > 0 else 0
            pixels_per_frame = resolution[0] * resolution[1] if resolution else 0
            total_frames = duration * fps if fps else 0
            
            clips_data.append({
                'filename': video_file.name,
                'file_size': file_size,
                'duration': duration,
                'fps': fps,
                'width': resolution[0] if resolution else 0,
                'height': resolution[1] if resolution else 0,
                'resolution': f"{resolution[0]}x{resolution[1]}" if resolution else "Unknown",
                'has_audio': has_audio,
                'bitrate': bitrate,
                'bytes_per_second': bytes_per_second,
                'pixels_per_frame': pixels_per_frame,
                'total_frames': total_frames
            })
            
            clip.close()
            file_count += 1
            
            # Show progress
            if file_count % 10 == 0:
                print(f"Processed {file_count}/{len(mp4_files)} files...")
                
        except Exception as e:
            errors.append({'filename': video_file.name, 'error': str(e)})
            print(f"Error reading {video_file.name}: {e}")
    
    if file_count == 0:
        print("No clips were successfully analyzed")
        return
    
    # Calculate comprehensive statistics
    print("\n" + "="*80)
    print("COMPREHENSIVE CLIP ANALYSIS")
    print("="*80)
    
    # Basic counts
    print(f"\n📊 DATASET OVERVIEW")
    print(f"  Total clips analyzed: {file_count}")
    if errors:
        print(f"  Failed to analyze: {len(errors)}")
    
    # File size statistics
    file_sizes = [c['file_size'] for c in clips_data]
    total_size = sum(file_sizes)
    print(f"\n💾 FILE SIZE STATISTICS")
    print(f"  Total size: {total_size / (1024**3):.2f} GB ({total_size / (1024**2):.2f} MB)")
    print(f"  Average: {statistics.mean(file_sizes) / (1024**2):.2f} MB")
    print(f"  Median: {statistics.median(file_sizes) / (1024**2):.2f} MB")
    print(f"  Std Dev: {statistics.stdev(file_sizes) / (1024**2):.2f} MB" if len(file_sizes) > 1 else "  Std Dev: N/A")
    print(f"  Min: {min(file_sizes) / (1024**2):.2f} MB")
    print(f"  Max: {max(file_sizes) / (1024**2):.2f} MB")
    
    # Duration statistics
    durations = [c['duration'] for c in clips_data]
    total_duration = sum(durations)
    print(f"\n⏱️  DURATION STATISTICS")
    print(f"  Total duration: {total_duration / 60:.2f} minutes ({total_duration:.1f} seconds)")
    print(f"  Average: {statistics.mean(durations):.2f} seconds")
    print(f"  Median: {statistics.median(durations):.2f} seconds")
    print(f"  Std Dev: {statistics.stdev(durations):.2f} seconds" if len(durations) > 1 else "  Std Dev: N/A")
    print(f"  Min: {min(durations):.2f} seconds")
    print(f"  Max: {max(durations):.2f} seconds")
    
    # Bytes per second (most important for estimation)
    bytes_per_sec = [c['bytes_per_second'] for c in clips_data]
    avg_bytes_per_sec = statistics.mean(bytes_per_sec)
    print(f"\n📈 BYTES PER SECOND (Critical for size estimation)")
    print(f"  Average: {avg_bytes_per_sec:.2f} bytes/s ({avg_bytes_per_sec / (1024**2):.4f} MB/s)")
    print(f"  Median: {statistics.median(bytes_per_sec):.2f} bytes/s ({statistics.median(bytes_per_sec) / (1024**2):.4f} MB/s)")
    print(f"  Std Dev: {statistics.stdev(bytes_per_sec):.2f} bytes/s" if len(bytes_per_sec) > 1 else "  Std Dev: N/A")
    print(f"  Min: {min(bytes_per_sec):.2f} bytes/s ({min(bytes_per_sec) / (1024**2):.4f} MB/s)")
    print(f"  Max: {max(bytes_per_sec):.2f} bytes/s ({max(bytes_per_sec) / (1024**2):.4f} MB/s)")
    
    # Bitrate statistics
    bitrates = [c['bitrate'] for c in clips_data]
    print(f"\n🎬 BITRATE STATISTICS")
    print(f"  Average: {statistics.mean(bitrates) / 1_000_000:.2f} Mbps")
    print(f"  Median: {statistics.median(bitrates) / 1_000_000:.2f} Mbps")
    print(f"  Std Dev: {statistics.stdev(bitrates) / 1_000_000:.2f} Mbps" if len(bitrates) > 1 else "  Std Dev: N/A")
    print(f"  Min: {min(bitrates) / 1_000_000:.2f} Mbps")
    print(f"  Max: {max(bitrates) / 1_000_000:.2f} Mbps")
    
    # FPS statistics
    fps_values = [c['fps'] for c in clips_data if c['fps']]
    if fps_values:
        print(f"\n🎥 FRAME RATE STATISTICS")
        print(f"  Average FPS: {statistics.mean(fps_values):.2f}")
        print(f"  Median FPS: {statistics.median(fps_values):.2f}")
        print(f"  Common FPS values: {', '.join(map(str, sorted(set(int(f) for f in fps_values))))}")
    
    # Resolution analysis
    resolutions = {}
    for c in clips_data:
        res = c['resolution']
        resolutions[res] = resolutions.get(res, 0) + 1
    
    print(f"\n📐 RESOLUTION DISTRIBUTION")
    for res, count in sorted(resolutions.items(), key=lambda x: x[1], reverse=True):
        percentage = (count / file_count) * 100
        print(f"  {res}: {count} clips ({percentage:.1f}%)")
    
    # Audio analysis
    clips_with_audio = sum(1 for c in clips_data if c['has_audio'])
    print(f"\n🔊 AUDIO PRESENCE")
    print(f"  Clips with audio: {clips_with_audio}/{file_count} ({(clips_with_audio/file_count)*100:.1f}%)")
    print(f"  Clips without audio: {file_count - clips_with_audio}/{file_count} ({((file_count-clips_with_audio)/file_count)*100:.1f}%)")
    
    # Advanced correlations
    print(f"\n🔍 CORRELATION ANALYSIS")
    
    # Group by resolution and analyze
    res_groups = {}
    for c in clips_data:
        res = c['resolution']
        if res not in res_groups:
            res_groups[res] = []
        res_groups[res].append(c['bytes_per_second'])
    
    print(f"\n  Bytes/second by resolution:")
    for res, bps_list in sorted(res_groups.items(), key=lambda x: len(x[1]), reverse=True):
        if len(bps_list) >= 3:  # Only show if enough samples
            avg_bps = statistics.mean(bps_list)
            print(f"    {res}: {avg_bps:.2f} bytes/s ({avg_bps / (1024**2):.4f} MB/s) - {len(bps_list)} samples")
    
    # Group by FPS
    fps_groups = {}
    for c in clips_data:
        fps_rounded = round(c['fps']) if c['fps'] else 0
        if fps_rounded not in fps_groups:
            fps_groups[fps_rounded] = []
        fps_groups[fps_rounded].append(c['bytes_per_second'])
    
    print(f"\n  Bytes/second by FPS:")
    for fps, bps_list in sorted(fps_groups.items(), key=lambda x: len(x[1]), reverse=True):
        if len(bps_list) >= 3 and fps > 0:  # Only show if enough samples
            avg_bps = statistics.mean(bps_list)
            print(f"    {fps} FPS: {avg_bps:.2f} bytes/s ({avg_bps / (1024**2):.4f} MB/s) - {len(bps_list)} samples")
    
    # Group by audio presence
    audio_groups = {'with_audio': [], 'without_audio': []}
    for c in clips_data:
        if c['has_audio']:
            audio_groups['with_audio'].append(c['bytes_per_second'])
        else:
            audio_groups['without_audio'].append(c['bytes_per_second'])
    
    print(f"\n  Bytes/second by audio presence:")
    if audio_groups['with_audio']:
        avg_bps = statistics.mean(audio_groups['with_audio'])
        print(f"    With audio: {avg_bps:.2f} bytes/s ({avg_bps / (1024**2):.4f} MB/s) - {len(audio_groups['with_audio'])} samples")
    if audio_groups['without_audio']:
        avg_bps = statistics.mean(audio_groups['without_audio'])
        print(f"    Without audio: {avg_bps:.2f} bytes/s ({avg_bps / (1024**2):.4f} MB/s) - {len(audio_groups['without_audio'])} samples")
    
    # RECOMMENDATIONS
    print(f"\n💡 RECOMMENDATIONS FOR SIZE ESTIMATION")
    print(f"  Primary constant to use: {avg_bytes_per_sec:.2f} bytes/s")
    
    # Calculate weighted average if there are dominant resolutions
    dominant_res = max(resolutions.items(), key=lambda x: x[1])
    if dominant_res[1] / file_count > 0.8:  # If >80% are same resolution
        print(f"  Note: {dominant_res[1]/file_count*100:.1f}% of clips are {dominant_res[0]}")
        print(f"        This constant is highly representative of your clip collection")
    else:
        print(f"  Note: Mixed resolutions detected - constant is averaged across all")
        print(f"        Consider using resolution-specific constants for higher accuracy:")
        for res, bps_list in sorted(res_groups.items(), key=lambda x: len(x[1]), reverse=True)[:3]:
            if len(bps_list) >= 3:
                print(f"          {res}: {statistics.mean(bps_list):.2f} bytes/s")
    
    # Outlier detection
    q1 = statistics.quantiles(bytes_per_sec, n=4)[0]
    q3 = statistics.quantiles(bytes_per_sec, n=4)[2]
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr
    outliers = [c for c in clips_data if c['bytes_per_second'] < lower_bound or c['bytes_per_second'] > upper_bound]
    
    if outliers:
        print(f"\n⚠️  OUTLIERS DETECTED")
        print(f"  {len(outliers)} clips have unusual bytes/second values:")
        
        # Separate high and low outliers
        high_outliers = [c for c in outliers if c['bytes_per_second'] > upper_bound]
        low_outliers = [c for c in outliers if c['bytes_per_second'] < lower_bound]
        
        if high_outliers:
            print(f"\n  📈 HIGH OUTLIERS ({len(high_outliers)} clips - unusually large file size):")
            # Sort by bytes_per_second descending
            high_outliers.sort(key=lambda x: x['bytes_per_second'], reverse=True)
            for c in high_outliers[:10]:  # Show up to 10
                print(f"    {c['bytes_per_second']:.2f} bytes/s | {c['resolution']} | {c['fps']:.1f} FPS | {c['duration']:.1f}s | Audio: {c['has_audio']} | {c['file_size']/(1024**2):.2f} MB")
                print(f"      └─ {c['filename']}")
            if len(high_outliers) > 10:
                print(f"    ... and {len(high_outliers) - 10} more high outliers")
        
        if low_outliers:
            print(f"\n  📉 LOW OUTLIERS ({len(low_outliers)} clips - unusually small file size):")
            # Sort by bytes_per_second ascending
            low_outliers.sort(key=lambda x: x['bytes_per_second'])
            for c in low_outliers[:10]:  # Show up to 10
                print(f"    {c['bytes_per_second']:.2f} bytes/s | {c['resolution']} | {c['fps']:.1f} FPS | {c['duration']:.1f}s | Audio: {c['has_audio']} | {c['file_size']/(1024**2):.2f} MB")
                print(f"      └─ {c['filename']}")
            if len(low_outliers) > 10:
                print(f"    ... and {len(low_outliers) - 10} more low outliers")
        
        # Analyze what makes outliers different
        print(f"\n  🔬 OUTLIER ANALYSIS - What makes them different?")
        
        # Compare high outliers to normal clips
        if high_outliers:
            normal_clips = [c for c in clips_data if lower_bound <= c['bytes_per_second'] <= upper_bound]
            
            print(f"\n    High Outliers vs Normal Clips:")
            
            # Resolution comparison
            high_res = [c['resolution'] for c in high_outliers]
            normal_res = [c['resolution'] for c in normal_clips] if normal_clips else []
            from collections import Counter
            high_res_dist = Counter(high_res)
            normal_res_dist = Counter(normal_res) if normal_res else Counter()
            
            print(f"\n      Resolution Distribution:")
            print(f"        High Outliers: {dict(high_res_dist)}")
            if normal_res_dist:
                print(f"        Normal Clips:  {dict(list(normal_res_dist.most_common(3)))}")
            
            # FPS comparison
            if high_outliers:
                high_avg_fps = statistics.mean([c['fps'] for c in high_outliers if c['fps']])
                normal_avg_fps = statistics.mean([c['fps'] for c in normal_clips if c['fps']]) if normal_clips else 0
                print(f"\n      Average FPS:")
                print(f"        High Outliers: {high_avg_fps:.2f}")
                if normal_clips:
                    print(f"        Normal Clips:  {normal_avg_fps:.2f}")
                    print(f"        Difference:    {high_avg_fps - normal_avg_fps:+.2f} FPS ({((high_avg_fps/normal_avg_fps - 1)*100):+.1f}%)")
            
            # Bitrate comparison
            high_avg_bitrate = statistics.mean([c['bitrate'] for c in high_outliers])
            normal_avg_bitrate = statistics.mean([c['bitrate'] for c in normal_clips]) if normal_clips else 0
            print(f"\n      Average Bitrate:")
            print(f"        High Outliers: {high_avg_bitrate/1_000_000:.2f} Mbps")
            if normal_clips:
                print(f"        Normal Clips:  {normal_avg_bitrate/1_000_000:.2f} Mbps")
                print(f"        Difference:    {(high_avg_bitrate - normal_avg_bitrate)/1_000_000:+.2f} Mbps ({((high_avg_bitrate/normal_avg_bitrate - 1)*100):+.1f}%)")
            
            # Duration comparison
            high_avg_duration = statistics.mean([c['duration'] for c in high_outliers])
            normal_avg_duration = statistics.mean([c['duration'] for c in normal_clips]) if normal_clips else 0
            print(f"\n      Average Duration:")
            print(f"        High Outliers: {high_avg_duration:.2f} seconds")
            if normal_clips:
                print(f"        Normal Clips:  {normal_avg_duration:.2f} seconds")
                print(f"        Difference:    {high_avg_duration - normal_avg_duration:+.2f} seconds ({((high_avg_duration/normal_avg_duration - 1)*100):+.1f}%)")
            
            # Audio presence
            high_audio_pct = sum(1 for c in high_outliers if c['has_audio']) / len(high_outliers) * 100
            normal_audio_pct = (sum(1 for c in normal_clips if c['has_audio']) / len(normal_clips) * 100) if normal_clips else 0
            print(f"\n      Audio Presence:")
            print(f"        High Outliers: {high_audio_pct:.1f}% have audio")
            if normal_clips:
                print(f"        Normal Clips:  {normal_audio_pct:.1f}% have audio")
            
            # Pixels per frame comparison
            high_avg_pixels = statistics.mean([c['pixels_per_frame'] for c in high_outliers])
            normal_avg_pixels = statistics.mean([c['pixels_per_frame'] for c in normal_clips]) if normal_clips else 0
            print(f"\n      Average Pixels per Frame:")
            print(f"        High Outliers: {high_avg_pixels:,.0f} pixels")
            if normal_clips:
                print(f"        Normal Clips:  {normal_avg_pixels:,.0f} pixels")
                print(f"        Difference:    {high_avg_pixels - normal_avg_pixels:+,.0f} pixels ({((high_avg_pixels/normal_avg_pixels - 1)*100):+.1f}%)")
            
            # Key findings
            print(f"\n      💡 Key Findings:")
            findings = []
            
            if normal_clips:
                if abs((high_avg_fps/normal_avg_fps - 1)*100) > 10:
                    findings.append(f"FPS difference: {((high_avg_fps/normal_avg_fps - 1)*100):+.1f}%")
                if abs((high_avg_bitrate/normal_avg_bitrate - 1)*100) > 10:
                    findings.append(f"Bitrate difference: {((high_avg_bitrate/normal_avg_bitrate - 1)*100):+.1f}%")
                if abs((high_avg_pixels/normal_avg_pixels - 1)*100) > 10:
                    findings.append(f"Resolution difference: {((high_avg_pixels/normal_avg_pixels - 1)*100):+.1f}%")
                if abs(high_audio_pct - normal_audio_pct) > 20:
                    findings.append(f"Audio presence difference: {high_audio_pct - normal_audio_pct:+.1f}%")
                
                if findings:
                    for finding in findings:
                        print(f"        • {finding}")
                else:
                    print(f"        • Outliers have similar properties to normal clips")
                    print(f"        • High bytes/s may be due to complex scene content or encoding settings")
    else:
        print(f"\n✅ NO OUTLIERS DETECTED - All clips have consistent bytes/second values")
    
    print(f"\n" + "="*80)
    
    # Show errors if any
    if errors:
        print(f"\n❌ ERRORS ENCOUNTERED")
        for err in errors[:10]:  # Show up to 10 errors
            print(f"  {err['filename']}: {err['error']}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more errors")
    
    return clips_data

if __name__ == "__main__":
    clips_directory = r"C:\Users\neong.ELITEROOMHEATER\Downloads\Twitch_Clips"
    analyze_clips_advanced(clips_directory)
