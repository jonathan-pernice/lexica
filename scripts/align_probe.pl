#!/usr/bin/perl
# align_probe.pl — SCOPING PROBE (read-only, no DB writes)
# Sequence-aligns ABP Genesis Strong's vs Rahlfs-1935 Strong's, verse by verse,
# to measure how cleanly the pronoun-defect (ABP G1473) resolves to the correct
# Rahlfs number (αὐτός=846, σου=4675, …) and how many slots need manual review.
#
# Usage: perl scripts/align_probe.pl <ABP_genesis.txt> <RAHLFS_repo_dir>
use strict; use warnings;
use utf8; binmode(STDOUT, ":utf8");

my $ABP  = shift @ARGV;
my $RDIR = shift @ARGV;

# ── pronoun identity sets (Strong's bare numbers) ──────────────────────────
my %EGO    = map {$_=>1} qw(1473 1700 1698 1691 3165 3427 3450); # ἐγώ sing (keep)
my %HEMEIS = map {$_=>1} qw(2249 2257 2254 2248);                 # ἡμεῖς (split)
my %SU     = map {$_=>1} qw(4771 4675 4671 4571 4674);            # σύ family (fix)
my %HUMEIS = map {$_=>1} qw(5210 5216 5213 5209);                 # ὑμεῖς family (fix)
# αὐτός = 846 (fix)

sub base { my $s=shift; return '' unless defined $s; $s=~s/\s//g; $s=~s/^G//; $s=~s/\..*$//; return $s; }

# ── 1. Rahlfs: versification (start word-index per verse) ───────────────────
my @vers; # [idx,b,c,v] in file order
open(my $VF, "<:encoding(UTF-8)", "$RDIR/12-Marvel.Bible/00-versification_original.csv") or die "vers: $!";
while (<$VF>) { chomp; my @p=split(/\t/);
  next unless defined $p[1]; my $ref=$p[1]; $ref=~s/^\x{2020}//; next unless $ref=~/^\d+\.\d+\.\d+$/;
  my($b,$c,$v)=split(/\./,$ref); push @vers,[$p[0]+0,$b+0,$c+0,$v+0];
}
close $VF;
# Genesis (b==1) verse ranges: start..(next entry idx - 1)
my %RANGE; # "c:v" => [start,end]
for my $i (0..$#vers) {
  next unless $vers[$i][1]==1;
  my $start=$vers[$i][0];
  my $end = ($i<$#vers) ? $vers[$i+1][0]-1 : $start;
  $RANGE{"$vers[$i][2]:$vers[$i][3]"}=[$start,$end];
}

# ── 2. Rahlfs parallel arrays (strong, greek, morph) by word index ──────────
my (@S,@Gk,@Mo);
sub load_col { my($path,$col,$ref)=@_; open(my $F,"<:encoding(UTF-8)",$path) or die "$path: $!";
  while(<$F>){chomp; my @p=split(/\t/); next unless defined $p[0] && $p[0]=~/^\d+$/; my $val=$p[$col]//''; $val=~s/\r//g; $ref->[$p[0]]=$val; } close $F; }
load_col("$RDIR/07_StrongNumber/final_Strongs.csv",1,\@S);
load_col("$RDIR/01_wordlist_unicode/text_accented.csv",2,\@Gk);
load_col("$RDIR/03a_morphology_with_JTauber_patches/patched_623693.csv",1,\@Mo);

# ── 3. ABP Genesis: per-verse Strong's sequence ─────────────────────────────
my %ABP; # "c:v" => [ base,base,... ]
open(my $AF,"<:encoding(UTF-8)",$ABP) or die "abp: $!";
while(<$AF>){ chomp;
  next unless /^\(Gen\s+(\d+):(\d+)\)\s+(.*)/; my($c,$v,$txt)=($1,$2,$3);
  my @seq; while($txt=~/(G\*|G\d+(?:\.\d+)*)/g){ push @seq, base($1); }
  $ABP{"$c:$v"}=\@seq;
}
close $AF;

# ── 4. Needleman–Wunsch global alignment ────────────────────────────────────
sub align {
  my($a,$b,$bpron)=@_; my $n=@$a; my $m=@$b;   # $bpron->[j] = 1 if Rahlfs token j is a pronoun (RP/RD/RR/RI)
  my $MATCH=3; my $MIS=-1; my $GAP=-2;
  my @D; my @T; # score, traceback
  for my $i (0..$n){ $D[$i][0]=$i*$GAP; $T[$i][0]='U'; }
  for my $j (0..$m){ $D[0][$j]=$j*$GAP; $T[0][$j]='L'; }
  $T[0][0]='X';
  for my $i (1..$n){ for my $j (1..$m){
    my $ai=$a->[$i-1]; my $bj=$b->[$j-1];
    my $eq = ($ai ne '' && $ai ne '*' && $ai eq $bj)
           || ($ai eq '1473' && $bpron && $bpron->[$j-1]);  # pronoun-aware: 1473 ↔ any Rahlfs pronoun
    my $diag=$D[$i-1][$j-1]+($eq?$MATCH:$MIS);
    my $up  =$D[$i-1][$j]+$GAP;
    my $lf  =$D[$i][$j-1]+$GAP;
    if($diag>=$up && $diag>=$lf){ $D[$i][$j]=$diag; $T[$i][$j]='D'; }
    elsif($up>=$lf){ $D[$i][$j]=$up; $T[$i][$j]='U'; }
    else{ $D[$i][$j]=$lf; $T[$i][$j]='L'; }
  }}
  my @pairs; my $i=$n; my $j=$m;
  while($i>0 || $j>0){ my $t=$T[$i][$j];
    if($t eq 'D'){ unshift @pairs,[$i-1,$j-1]; $i--; $j--; }
    elsif($t eq 'U'){ unshift @pairs,[$i-1,-1]; $i--; }
    else{ unshift @pairs,[-1,$j-1]; $j--; }
  }
  return \@pairs;
}

# ── 5. Run over all Genesis verses, accumulate metrics ──────────────────────
my ($tot_abp,$tot_rah,$anchor,$verses,$verses_both)=(0,0,0,0,0);
my ($n1473,$fix_autos,$fix_su,$fix_humeis,$hemeis,$keep_ego,$flag)=(0,0,0,0,0,0,0);
my %flag_examples; my $gen316_dump=''; my %ftype; my @flagverse;

for my $c (1..50){ for my $v (1..200){
  my $key="$c:$v";
  next unless exists $ABP{$key};
  $verses++;
  my $abp=$ABP{$key};
  $tot_abp += scalar @$abp;
  next unless exists $RANGE{$key};
  my($s,$e)=@{$RANGE{$key}};
  my @rah = map { base($S[$_]) } ($s..$e);
  my @ridx = ($s..$e);
  my @rpron = map { (defined $Mo[$_] && $Mo[$_]=~/^R(?!A)/) ? 1 : 0 } ($s..$e);  # pronoun flag (exclude RA=article)
  $tot_rah += scalar @rah;
  $verses_both++;
  my $pairs=align($abp,\@rah,\@rpron);
  my $verse_flagged=0;
  for my $p (@$pairs){
    my($ai,$bj)=@$p;
    my $a = $ai>=0 ? $abp->[$ai] : undef;
    my $b = $bj>=0 ? $rah[$bj] : undef;
    $anchor++ if defined $a && defined $b && $a ne '' && $a ne '*' && $a eq $b;
    next unless defined $a && $a eq '1473';   # only the defect slots
    $n1473++;
    if(!defined $b || $b eq ''){ $flag++; $verse_flagged=1;
      $ftype{ defined $b ? 'BLANK  (Rahlfs has word but no Strong#)' : 'GAP    (ABP word absent in Rahlfs)' }++;
      $flag_examples{"$key  ABP G1473 -> ".(defined $b?"BLANK":"GAP")}++; next; }
    if($b eq '846'){ $fix_autos++; }
    elsif($SU{$b}){ $fix_su++; }
    elsif($HUMEIS{$b}){ $fix_humeis++; }
    elsif($HEMEIS{$b}){ $hemeis++; }
    elsif($EGO{$b}){ $keep_ego++; }
    else { $flag++; $verse_flagged=1; my $pos=(split/\./,($Mo[$ridx[$bj]]//'?'))[0]||'?';
      $ftype{"MISMATCH -> Rahlfs $pos"}++;
      $flag_examples{"$key  ABP G1473 -> G$b (".($Mo[$ridx[$bj]]//'?').")"}++; }
  }
  # capture a few full flagged-verse alignments for eyeballing
  if($verse_flagged && @flagverse < 6){
    my $d="  Gen $key\n";
    for my $p (@$pairs){ my($ai,$bj)=@$p;
      my $as=$ai>=0?"G".$abp->[$ai]:"—";
      my $bg=$bj>=0?($Gk[$ridx[$bj]]//'?'):"—";
      my $bs=$bj>=0?"G".$rah[$bj]:"—";
      my $bm=$bj>=0?($Mo[$ridx[$bj]]//''):'';
      my $mk=($ai>=0 && $abp->[$ai] eq '1473')?"  <== ABP-1473":"";
      $d.=sprintf("     ABP %-7s | Rahlfs %-11s %-7s %-8s%s\n",$as,$bg,$bs,$bm,$mk);
    }
    push @flagverse,$d;
  }
  # capture Gen 3:16 alignment for display
  if($key eq '3:16'){
    for my $p (@$pairs){ my($ai,$bj)=@$p;
      my $as = $ai>=0 ? "G".$abp->[$ai] : "—";
      my $bg = $bj>=0 ? ($Gk[$ridx[$bj]]//'?') : "—";
      my $bs = $bj>=0 ? "G".$rah[$bj] : "—";
      my $bm = $bj>=0 ? ($Mo[$ridx[$bj]]//'') : '';
      my $mark = ($ai>=0 && $abp->[$ai] eq '1473') ? "  <== ABP-1473" : "";
      $gen316_dump .= sprintf("   ABP %-8s  |  Rahlfs %-10s %-8s %-8s%s\n",$as,$bg,$bs,$bm,$mark);
    }
  }
}}

my $fix_total=$fix_autos+$fix_su+$fix_humeis;
printf "\n══════════ GENESIS ALIGNMENT PROBE ══════════\n";
printf "ABP Genesis verses parsed       : %d\n",$verses;
printf "verses aligned (in both)        : %d\n",$verses_both;
printf "ABP words / Rahlfs words        : %d / %d\n",$tot_abp,$tot_rah;
printf "anchor matches (equal Strong's) : %d  (%.1f%% of ABP words)\n",$anchor,100*$anchor/($tot_abp||1);
printf "\n── ABP G1473 slots (the corruption) ──\n";
printf "total ABP G1473 in Genesis      : %d\n",$n1473;
printf "  -> αὐτός  G846        (FIX)   : %d\n",$fix_autos;
printf "  -> σύ family          (FIX)   : %d\n",$fix_su;
printf "  -> ὑμεῖς family       (FIX)   : %d\n",$fix_humeis;
printf "  -> ἡμεῖς 2249/57/54/48 (SPLIT): %d\n",$hemeis;
printf "  -> ἐγώ sing.          (KEEP)  : %d\n",$keep_ego;
printf "  -> FLAG (gap/blank/other)     : %d\n",$flag;
printf "\nRESOLVED CONFIDENTLY (fix+split+keep): %d / %d  = %.1f%%\n",
  ($fix_total+$hemeis+$keep_ego),$n1473,100*($fix_total+$hemeis+$keep_ego)/($n1473||1);
printf "NEEDS REVIEW (flagged)              : %d / %d  = %.1f%%\n",
  $flag,$n1473,100*$flag/($n1473||1);

print "\n── Gen 3:16 alignment (sanity) ──\n$gen316_dump";

print "\n── FLAG breakdown by type (thread A) ──\n";
for my $t (sort { $ftype{$b}<=>$ftype{$a} } keys %ftype){ printf "   %-42s %d\n",$t,$ftype{$t}; }

print "\n── sample full flagged-verse alignments ──\n";
print $_ for @flagverse;

print "\n(read-only probe — no database touched)\n";
